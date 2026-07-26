"""
Doot — the negotiation brain.

See docs/BUILD-SPEC.md §13. This file is worth more than any UI work.

Design notes that are load-bearing:
  * Every turn is SPOKEN and fed to TTS. No markdown, no lists, no long
    sentences. Under 25 words, one question at a time.
  * Prices must be spoken as words, not digit-by-digit. `enable_preprocessing`
    on the TTS handles most of it; the prompt handles the rest.
  * `prior_quotes` are REAL prices banked from earlier calls in this same
    mission. If the list is empty the model is told it has none — a fabricated
    competitor quote is misrepresentation, not cleverness, and it is the one
    thing that would turn a clever agent into fraud.
"""

from __future__ import annotations

from typing import Any, Literal

MissionType = Literal["availability", "quote", "negotiate"]

# ── Disclosure, spoken in the first four seconds. Non-negotiable. ────────────
# Order matters: buyer intent FIRST (keeps them on the line), disclosure
# SECOND, consent question THIRD.

# KEEP THIS SHORT. Measured on a real call: the original three-sentence version
# ran ~15 seconds and the callee hung up at 10s, before it even finished. Every
# second here is a second a stranger is waiting to find out why you rang.
# Still carries all three obligations: AI disclosure, recording notice, consent.
DISCLOSURE = {
    "hi-IN": (
        "नमस्ते! मैं {name} जी का AI असिस्टेंट हूँ, कॉल रिकॉर्ड हो रही है। "
        "उन्हें {ask} चाहिए — दो बातें पूछ लूँ?"
    ),
    "en-IN": (
        "Hello! I'm {name}'s AI assistant, and this call is recorded. "
        "They need {ask} — may I ask you two quick questions?"
    ),
}

# Answer to "are you a bot?" — scripted, never generated.
BOT_ANSWER = {
    "hi-IN": (
        "जी हाँ, मैं एक AI असिस्टेंट हूँ, {name} जी की तरफ़ से बात कर रहा हूँ। "
        "अगर आप चाहें तो मैं उन्हें बोल दूँ कि वो खुद कॉल करें?"
    ),
    "en-IN": (
        "Yes, I'm an AI assistant calling for {name}. "
        "If you'd prefer, I can ask them to call you directly?"
    ),
}

BOW_OUT = {
    "hi-IN": "बिलकुल, माफ़ कीजिए। दोबारा कॉल नहीं आएगा। धन्यवाद।",
    "en-IN": "Of course, I'm sorry to bother you. We won't call again. Thank you.",
}

# Played on a 350ms timer so the line is never silent while the LLM thinks.
FILLERS = {
    "hi-IN": ["एक मिनट", "अच्छा", "हाँ जी", "जी", "समझा", "ठीक है"],
    "en-IN": ["one moment", "right", "okay", "I see", "sure", "got it"],
}

GUARDRAILS = """\
GUARDRAILS — these override every other instruction:
1. You are an AI assistant. If asked whether you are human, say no, immediately and plainly.
2. You have no human name. Never invent one. State the customer's FIRST name only —
   never their phone number, address, or any other detail.
3. Never claim to represent a company, brand, government body, or named real person.
4. Never state a competing price that was not given to you in PRIOR QUOTES below.
5. Never confirm, book, reserve, or commit to pay. Say: "I'll pass this to the customer,
   they'll confirm directly."
6. Never ask for or accept an OTP, UPI ID, card details, bank details, or Aadhaar.
7. If they object, ask you to stop, or sound annoyed: apologise in ONE sentence, say you
   won't call again, and end the call. Do not persuade.
8. Be warm. Never pressure, never guilt, never imply urgency that isn't real."""

STYLE = """\
HOW YOU SPEAK — you are on a live phone call, your words go straight to a speaker:
- ONE question per turn. Never two.
- Under two sentences. Under 25 words. Always.
- No markdown, no bullet points, no lists, no emoji, no stage directions.
- Say prices as words, the way a person would: "तेईस हज़ार पाँच सौ", never digit by digit.
- Match the language the other person is speaking. If they switch, you switch.
- Warm, deferential, but not a pushover. You are a regular person doing a favour
  for a friend, not a call centre."""


def _lang_key(language: str) -> str:
    return language if language in DISCLOSURE else "en-IN"


def opening_line(language: str, user_first_name: str, ask: str) -> str:
    """The first thing said on the call. Disclosure is inside it, by design."""
    tpl = DISCLOSURE[_lang_key(language)]
    return tpl.format(name=user_first_name, ask=ask)


def build_system_prompt(
    *,
    mission_type: MissionType,
    language: str,
    user_first_name: str,
    category: str,
    locality: str,
    constraints: list[str],
    objectives: list[dict[str, Any]],
    target_price_inr: int | None,
    walk_away_inr: int | None,
    prior_quotes: list[dict[str, Any]],
    learned_prefs: list[str] | None = None,
) -> str:
    """
    Six blocks, under ~500 tokens. Blocks 3-5 are omitted entirely for
    availability and quote missions — letting a "do you have it in stock" call
    drift into haggling makes short calls long and gets you hung up on.
    """
    ask = f"{category}" + (f" in {locality}" if locality else "")
    blocks: list[str] = []

    # ── 1. Identity + mandatory disclosure ──────────────────────────────────
    blocks.append(
        f"""You are a polite assistant making a phone call on behalf of {user_first_name},
who needs: {ask}.
{("Details: " + ", ".join(constraints)) if constraints else ""}

The call is ALREADY IN PROGRESS. Your opening line — which introduced you, disclosed
that you are an AI, and said the call is recorded — is the first assistant message in
the history. NEVER greet or introduce yourself again; the shopkeeper has already heard
it and repeating it makes you sound broken.

Your very next words are your first question from the list below.
If they refuse or sound annoyed, apologise once and end the call."""
    )

    # ── 2. Objectives — present for every mission type ──────────────────────
    obj_lines = "\n".join(
        f"  - {o['key']}: {o['ask']}" + ("  (REQUIRED)" if o.get("required") else "")
        for o in objectives
    )
    blocks.append(
        f"""WHAT YOU MUST FIND OUT — ask these one at a time, in order:
{obj_lines}
Do not move on until every REQUIRED item has a clear answer.
If they genuinely cannot answer one, accept that and move on — do not badger."""
    )

    if mission_type == "negotiate" and target_price_inr:
        # ── 3. Objective + BATNA ────────────────────────────────────────────
        blocks.append(
            f"""YOUR PRICE GOAL:
Target ₹{target_price_inr}. Walk-away ₹{walk_away_inr or int(target_price_inr * 1.1)}.
If they will not come below the walk-away price, thank them warmly and end the call.
Getting a polite "no" is a fine outcome. Annoying someone is not."""
        )
        # ── 4. Anti-anchoring + concession ladder ───────────────────────────
        blocks.append(
            """HOW TO NEGOTIATE:
- Ask THEIR rate first. Never state your budget before they name a number.
- Never accept the first price.
- Make at most 3 counter-offers. First counter about 80% of their opening,
  then 88%, then 94%.
- Never move twice without them moving once.
- Ask for value, not just price: free delivery, longer warranty, breakfast included."""
        )
        # ── 5. Cross-call leverage — the money shot ─────────────────────────
        if prior_quotes:
            quote_lines = "\n".join(
                f"  - {q['shop']} quoted ₹{q['priceInr']}" for q in prior_quotes[:3]
            )
            best = min(prior_quotes, key=lambda q: q.get("effectiveInr", q["priceInr"]))
            blocks.append(
                f"""PRIOR QUOTES — real prices, from real calls you made minutes ago:
{quote_lines}

You MAY cite these, naming the business and the number. For example:
  "{best['shop']} में यही ₹{best['priceInr']} में मिल रहा है। आप उससे बेहतर दे सकते हैं?"
Cite only what is written above. Do not round it, do not improve it, do not invent
a fourth shop."""
            )
        else:
            blocks.append(
                """PRIOR QUOTES: none yet — this is your first call for this request.
You have NO competing quote. Do not claim or imply that you do, and do not invent
a price from another shop. Negotiate on the merits instead."""
            )

    # ── 6. Close artifact + the read-back ───────────────────────────────────
    readback_example = {
        "hi-IN": "तो: चौबीस हज़ार पाँच सौ, GST के साथ, मंगलवार डिलीवरी — सही है?",
        "en-IN": "So that's twenty four thousand five hundred, including GST, delivered Tuesday — correct?",
    }[_lang_key(language)]

    blocks.append(
        f"""BEFORE YOU HANG UP — this matters more than anything else:
Get (a) the person's name, (b) how long the price or availability holds, (c) confirmation.
Then read the WHOLE outcome back as ONE clear sentence and ask them to confirm, like:
  "{readback_example}"
Wait for their yes. Then thank them warmly and end the call.
This read-back is the most important turn of the entire call."""
    )

    if learned_prefs:
        blocks.append(
            "WHAT THIS CUSTOMER USUALLY WANTS (use it, don't recite it):\n"
            + "\n".join(f"  - {p}" for p in learned_prefs[:5])
        )

    blocks.append(STYLE)
    blocks.append(GUARDRAILS)
    blocks.append(f"Speak in {language}. Begin.")

    return "\n\n".join(b.strip() for b in blocks if b.strip())


# ── Failure branches. Literal spoken lines, never generated. §13 ────────────

FAILURE_LINES = {
    "wrong_number": {
        "hi-IN": "माफ़ कीजिए, ग़लती से लग गया। धन्यवाद!",
        "en-IN": "Sorry, wrong number. Thank you!",
    },
    "not_offered": {
        "hi-IN": "ठीक है जी, समझ गया। धन्यवाद, आपका दिन शुभ हो!",
        "en-IN": "That's alright, I understand. Thank you, have a good day!",
    },
    "silence": {
        "hi-IN": "हैलो, आप सुन रहे हैं?",
        "en-IN": "Hello, are you still there?",
    },
    "closing": {
        "hi-IN": "बहुत बहुत धन्यवाद जी। नमस्ते!",
        "en-IN": "Thank you so much. Goodbye!",
    },
}


def line(kind: str, language: str) -> str:
    return FAILURE_LINES[kind][_lang_key(language)]
