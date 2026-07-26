/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as calls from "../calls.js";
import type * as crons from "../crons.js";
import type * as direct from "../direct.js";
import type * as fit from "../fit.js";
import type * as gate from "../gate.js";
import type * as http from "../http.js";
import type * as intent from "../intent.js";
import type * as lib_compliance from "../lib/compliance.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_inr from "../lib/inr.js";
import type * as lib_phone from "../lib/phone.js";
import type * as lib_sarvam from "../lib/sarvam.js";
import type * as missions from "../missions.js";
import type * as orchestrator from "../orchestrator.js";
import type * as orchestratorQueries from "../orchestratorQueries.js";
import type * as summarise from "../summarise.js";
import type * as telegram from "../telegram.js";
import type * as telegramQueries from "../telegramQueries.js";
import type * as tgApi from "../tgApi.js";
import type * as transcripts from "../transcripts.js";
import type * as users from "../users.js";
import type * as vendors from "../vendors.js";
import type * as webconsole from "../webconsole.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  calls: typeof calls;
  crons: typeof crons;
  direct: typeof direct;
  fit: typeof fit;
  gate: typeof gate;
  http: typeof http;
  intent: typeof intent;
  "lib/compliance": typeof lib_compliance;
  "lib/constants": typeof lib_constants;
  "lib/inr": typeof lib_inr;
  "lib/phone": typeof lib_phone;
  "lib/sarvam": typeof lib_sarvam;
  missions: typeof missions;
  orchestrator: typeof orchestrator;
  orchestratorQueries: typeof orchestratorQueries;
  summarise: typeof summarise;
  telegram: typeof telegram;
  telegramQueries: typeof telegramQueries;
  tgApi: typeof tgApi;
  transcripts: typeof transcripts;
  users: typeof users;
  vendors: typeof vendors;
  webconsole: typeof webconsole;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
