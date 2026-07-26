/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as gate from "../gate.js";
import type * as intent from "../intent.js";
import type * as lib_compliance from "../lib/compliance.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_inr from "../lib/inr.js";
import type * as lib_phone from "../lib/phone.js";
import type * as lib_sarvam from "../lib/sarvam.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  gate: typeof gate;
  intent: typeof intent;
  "lib/compliance": typeof lib_compliance;
  "lib/constants": typeof lib_constants;
  "lib/inr": typeof lib_inr;
  "lib/phone": typeof lib_phone;
  "lib/sarvam": typeof lib_sarvam;
  users: typeof users;
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
