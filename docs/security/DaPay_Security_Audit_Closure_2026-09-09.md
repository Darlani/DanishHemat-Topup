# DaPay Security Audit Closure Evidence

## A. Document Metadata

- **System:** DaPay
- **Audit scope:** Targeted security findings F-01 through F-13, limited to supplied verification evidence.
- **Evidence closure date:** 2026-09-09
- **Source:** Runtime verification plus code and migration verification.
- **Caveat:** This document records verified findings and remaining evidence gaps. It is not a guarantee of zero future vulnerabilities.

## B. Executive Summary

F-01, F-02, F-03, F-04, F-05, F-07, F-09, F-10 Phase 1, F-11, and F-12 have recorded closure or verification evidence as stated below. F-03 remains closed with explicit coverage caveats for LIVE transactional production execution and synthetic cross-table collision testing. F-06 is low/informational. F-08 remains conditional/open because the trusted production proxy and IP-header contract is not proven. F-10 Phase 2 remains open because `unsafe-inline` and nonce/hash hardening are not complete.

## C. Finding Status Matrix

| Finding | Original classification | Current status | Remediation | Runtime evidence | Remaining caveat |
|---|---|---|---|---|---|
| F-01 | IDOR / authorization | PASS / CLOSED | Authenticated tester authorization and Sandbox ownership enforcement | Own order HTTP 200; cross-owner HTTP 404; non-tester HTTP 403; no-auth HTTP 401; invalid order HTTP 404; empty `order_id` HTTP 400 | No remaining evidence gap recorded |
| F-02 | JWT identity verification | PASS / CLOSED | Cryptographic Supabase user verification | Invalid/tampered credentials rejected; valid tester activation HTTP 200; non-tester/admin/manager HTTP 403 | No remaining evidence gap recorded |
| F-03 | Sandbox/LIVE table boundary | PASS / CLOSED WITH COVERAGE CAVEAT | Table-native routing, dedicated Sandbox worker, check-status boundary, hardened RPC environment contract | Phase 1 and Phase 2 evidence passed | LIVE transactional production coverage and synthetic collision remain unverified |
| F-04 | Proxy role authorization | PASS / CLOSED | `/admin` role resolved from verified identity and `profiles.role` | Forged role cookie cannot grant/revoke admin page access; API boundary remains protected | No remaining evidence gap recorded |
| F-05 | Environment resolver fail-open | IMPLEMENTED + VERIFIED | Fail-closed environment resolution | Regression verified during F-03; no active LIVE fallback path | No remaining evidence gap recorded |
| F-06 | Low / informational | CLOSED / INFORMATIONAL | No remediation required; DELETE only clears caller-owned Sandbox session cookie | Unauthenticated DELETE tested by read-only review; no activation, DB query, or state mutation | Impact limited to self-logout/session disarm |
| F-07 | Sandbox session cookie exposure | PASS / CLOSED | `dapay_sandbox_session` made HttpOnly | Activation HTTP 200; cookie attributes verified; GET/DELETE lifecycle verified; malformed cookie rejected | No remaining evidence gap recorded |
| F-08 | Proxy IP trust / blacklist fail-open | CONDITIONAL / OPEN | Deferred pending deployment and trusted-proxy proof | Trusted production proxy/header contract not proven | Historical VPS + Cloudflare context is not current deployment proof |
| F-09 | Wildcard development origin | PASS / CLOSED | Removed `allowedDevOrigins: ["*"]` | Localhost and core-page smoke passed; arbitrary Origin did not receive wildcard/reflected ACAO; HMR available; build exit code 0 | No remaining evidence gap recorded |
| F-10 | CSP hardening | Phase 1 PASS / CLOSED; Phase 2 OPEN | Removed production `unsafe-eval`; retained `unsafe-inline` temporarily | Dev retains `unsafe-eval`; production removes it; login, 2FA, admin/user, Turnstile, and build smoke passed | Nonce/hash removal of production `unsafe-inline` remains open |
| F-11 | Service-role BFF usage | NO REMEDIATION REQUIRED | Existing server-side service-role usage retained | No demonstrated secret or privilege leak | Classification depends on continued server-side isolation |
| F-12 | Environment selector / routing synchronization | CLOSED AS PART OF F-03 | Client-controlled `is_sandbox` selector removed; table boundary enforced | Environment routing and F-03 regression evidence passed | Covered by F-03 closure evidence |
| F-13 | Formal audit evidence record | Documentation task | This closure artifact | Evidence supplied by prior verification records | This artifact does not add independent runtime evidence |

## D. Detailed Evidence

### F-01 - Tester Simulate-Pay Authorization

- **Original finding:** Suspected missing authentication, authorization, and Sandbox order ownership validation.
- **Remediation:** Server-side authentication, tester-role verification, Sandbox-only lookup, and ownership enforcement.
- **Independent verification:**
  - Tester A own order: HTTP 200, `success=true`, Sandbox-only processing.
  - Tester B cross-owner request: HTTP 404 generic response.
  - Non-tester: HTTP 403.
  - No authentication: HTTP 401.
  - Invalid order: HTTP 404.
  - Empty `order_id`: HTTP 400.
  - Cross-owner request caused no order or wallet mutation.
- **Final status:** PASS / CLOSED.

### F-02 - Tester Session JWT Verification

- **Original finding:** Suspected manual JWT parsing before cryptographic verification.
- **Remediation:** Identity sourced from `supabaseAdmin.auth.getUser()` after token verification; profile role and tester status enforced.
- **Independent verification:**
  - No authentication: HTTP 401.
  - Tampered Bearer token: HTTP 401.
  - Tampered Supabase cookie: HTTP 401.
  - Valid tester activation: HTTP 200.
  - Non-tester: HTTP 403.
  - Admin: HTTP 403.
  - Manager: HTTP 403.
- **Final status:** PASS / CLOSED.

### F-03 Phase 1 - RPC and Creation Boundary

- **Original finding:** Environment selection could cross LIVE/Sandbox table boundaries.
- **Remediation:** Migration `20260908120000_harden_order_environment_routing.sql`; trusted environment parameter; old RPC locked; new RPC restricted to `service_role`; creation routing synchronized with fail-closed resolver.
- **Verification:**
  - Migration applied and remote verified.
  - Old 4-argument RPC privileges: all false for `public`, `anon`, `authenticated`, and `service_role`.
  - New 5-argument RPC: `service_role` true only.
  - Sandbox creation routing: PASS.
  - RPC boundary: PASS.
  - F-01 regression: PASS.
- **Final status:** PASS / CLOSED WITH COVERAGE CAVEAT.

### F-03 Phase 2 - Sandbox Worker and Check-Status Boundary

- **Remediation:** Dedicated Sandbox worker reads `sandbox_orders`; Sandbox check-status rejects Sandbox rows before provider calls; LIVE/Sandbox worker boundary enforced.
- **Verification:**
  - Sandbox worker: PASS.
  - Sandbox check-status: HTTP 403 with no provider call.
  - Unknown identifier: HTTP 404.
  - LIVE/Sandbox worker boundary: PASS.
  - Global mode boundary: PASS.
  - F-01 regression: PASS.
  - F-02 smoke regression: PASS.
  - Test fixtures cleaned exactly.
- **Final status:** PASS / CLOSED WITH COVERAGE CAVEAT.

### F-04 - Proxy Role Security Boundary

- **Original finding:** Raw client-controlled `userRole` cookie influenced `/admin` page gating.
- **Remediation:** `/admin` role decision uses verified identity and `profiles.role`; API authorization remains server-side.
- **Verification:**
  - Forged member cookie `userRole=admin`: redirected to `/user`.
  - Admin with forged `userRole=member`: `/admin` allowed.
  - Manager with forged `userRole=member`: `/admin` allowed.
  - Invalid token plus forged cookie: login redirect.
  - Admin API boundary remains protected.
  - Profile role lookup is used for `/admin`.
  - Performance smoke: approximately 319 ms average.
- **Final status:** PASS / CLOSED.

### F-05 - Fail-Closed Environment Resolver

- **Original finding:** Resolver failure could fall back to LIVE.
- **Remediation:** `resolveOrderEnvironment()` fails closed and separates system failure from valid business decisions.
- **Verification:** F-05 regression passed during F-03 verification. No active `SYSTEM_FALLBACK_LIVE` behavior remains.
- **Final status:** IMPLEMENTED + VERIFIED.

### F-07 - Sandbox Session Cookie

- **Original finding:** `dapay_sandbox_session` was client-readable.
- **Remediation:** Cookie set and cleared with HttpOnly and existing path, lifetime, SameSite, and secure policy.
- **Verification:**
  - Tester activation: HTTP 200.
  - `HttpOnly=true`, `Path=/`, `Max-Age=3600`, `SameSite=Lax`.
  - GET returned `isSandboxActive=true`.
  - DELETE cleared the cookie.
  - GET after deletion returned `false`.
  - Client JavaScript could not read the cookie.
  - Role restrictions remained HTTP 403.
  - Malformed cookie did not activate Sandbox.
- **Final status:** PASS / CLOSED.

### F-09 - Development Origin Hardening

- **Original finding:** Wildcard `allowedDevOrigins` configuration.
- **Remediation:** Removed `allowedDevOrigins: ["*"]`.
- **Verification:** Localhost returned HTTP 200; core pages rendered; arbitrary Origin received no wildcard/reflected ACAO; HMR infrastructure was available; build exit code was 0.
- **Final status:** PASS / CLOSED.

### F-10 Phase 1 - Production CSP `unsafe-eval`

- **Original finding:** Same CSP used `unsafe-eval` in all environments.
- **Remediation:** Production CSP removes `unsafe-eval`; development CSP retains it for development compatibility. `unsafe-inline` remains temporarily. Turnstile origin remains allowed.
- **Verification:** Development and production CSP behavior matched the intended split; login, setup-2FA, admin/user smoke, Turnstile, and build passed.
- **Final status:** PASS / CLOSED for Phase 1. Phase 2 remains open.

### F-11 - Service-Role BFF Usage

- **Finding:** Server-side service-role usage was reviewed as a possible concern.
- **Verification:** Classified as normal BFF security control; no demonstrated secret leak.
- **Final status:** NO REMEDIATION REQUIRED.

### F-12 - Environment Routing Synchronization

- **Finding:** Client-controlled environment selector and routing/RPC synchronization risk.
- **Remediation:** Client-controlled `is_sandbox` selector removed; environment and table boundary synchronized under F-03.
- **Verification:** F-03 routing, RPC boundary, and regression evidence passed.
- **Final status:** CLOSED AS PART OF F-03.

## E. Explicit Unverified and Deferred Items

- **F-03 LIVE transactional production coverage:** NOT EXECUTED because `store_settings.is_live_mode=false`; no production mode change was made.
- **F-03 synthetic cross-table collision:** UNVERIFIED; no existing collision was found and no synthetic collision was created.
- **F-06:** CLOSED / INFORMATIONAL. Unauthenticated DELETE only clears caller-owned `dapay_sandbox_session` with HttpOnly, Path=/, Max-Age=0, SameSite=Lax, and production Secure. It cannot activate Sandbox, affect another user, mutate DB/wallet/order/ledger/profile state, or grant tester access.
- **F-08 deployment-dependent IP trust:** CONDITIONAL / OPEN; trusted production proxy and header contract are not proven.
- **F-10 Phase 2:** OPEN; production `unsafe-inline` remains and nonce/hash hardening is not implemented.
- **F-13 evidence limitation:** This document formalizes supplied evidence only; it does not independently reproduce tests or add new runtime evidence.

## F. Security Regression Summary

- **F-01 regression:** PASS during F-03 Phase 1 and Phase 2 verification.
- **F-02 regression:** PASS during F-03 Phase 2 smoke verification.
- **F-03 regression:** Sandbox routing, worker boundary, global mode boundary, and RPC boundary passed; stated coverage caveats remain.

## G. Test Fixture Cleanup Evidence

- **Removed fixture ID:** `3d621c8c-9f37-4d99-9a92-f2fc391deb91`
- **Removed fixture ID:** `47f4361c-8def-437d-a7a9-4fe31d20355d`
- **Deleted count:** 2
- **Related `sandbox_balance_logs` rows:** 0
- **Initial sandbox bonus:** `d130f739-cbeb-40e2-9fa7-06d51145824c` untouched.
- **`public.orders`:** untouched.
- **Cleanup scope:** Exact ID allowlist only.

## H. Migration Evidence

- **Migration:** `supabase/migrations/20260908120000_harden_order_environment_routing.sql`
- **SHA-256:** `967B9202BF3F54DC30FD07699A63B4F2C5F9452E238512F4F65DE4416E9FE299`
- **Status:** Applied and remote verified.
- **Old 4-argument RPC privileges:** All false for `public`, `anon`, `authenticated`, and `service_role`.
- **New 5-argument RPC privileges:** `service_role` true only.

## I. Final Open Items and Future Work

1. F-08: prove actual production reverse-proxy and trusted IP-header contract before changing IP extraction or blacklist behavior.
2. F-10 Phase 2: design and verify nonce/hash CSP before removing production `unsafe-inline`.
3. F-03: obtain safe LIVE table-routing coverage without changing production mode or executing a real transaction.
4. F-03: run safe synthetic cross-table collision coverage only in an isolated non-production environment.
5. F-06: retain as low/informational follow-up item unless explicitly reopened.

## Evidence Handling Statement

No passwords, tokens, secrets, service-role keys, cookie values, or personal credential data are recorded in this document. No application code, database schema, migration, deployment configuration, provider behavior, or production data was changed to create this record.
