# TezCheck subscription checkout — 2026-10-27

Contract source: user-supplied TezCheck Merchant API documentation. Orbit search returned unrelated providers; no TezCheck resource reused. Owner mock search was unavailable because Postman CLI is signed out; local contract fixture used. No provider secrets are stored here.

Run `postman simulation run postman/simulations/tezcheck.sim.yaml --port 4902 --output ndjson`, then `TEZCHECK_SIMULATION_URL=http://127.0.0.1:4902/merchant node --test tests/tezcheck.test.cjs`.

The actual fetch client sends signed POST bill-status requests. Fixture verifies desk/header/HMAC using fictional credentials, returns documented live bill/payment and HTML503 on link_failure. Both requests appear in the simulation log. First run read the intercepted request stream twice; mock now reads req.body. Production webhook independently hashes original bytes; its HTTP test covers both root and dedicated paths, tampering and health.

Backend replica-set tests cover concurrent pending creation, duplicate/replayed events, one grant, amounts/environment/bill ownership, refunds and checkout URL ownership. Refunds/disputes flag reconciliation without revoking unrelated grants. Live GET /me established DESK-67 and request_signed=true. A live 1000 UZS validation bill was created, read back unpaid and immediately cancelled; its checkout host was tezcheck.uz. No real payment was performed. Production still needs a real buyer payment to prove provider delivery end to end.

Bot is the merchant client and HMAC verifier. Backend bot-auth endpoints persist order/bill/provider IDs and atomically grant a subscription. TezCheck secrets are configured on bot hosting only. A checkout callback reuses a stable message/plan key; ambiguous unbound orders older than23h are not recreated after provider idempotency expiry. Repeated signed attempts use fresh timestamps. Status button reads canonical bill state if webhook delivery is missed.
