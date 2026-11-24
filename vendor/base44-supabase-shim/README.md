# @staticbot/base44-supabase-shim

Drop-in shim that exposes the **same surface as `@base44/sdk`** but routes
every call to a **Supabase** backend (Postgres + GoTrue + Storage + Edge
Functions). Built so you swap one import in `src/api/base44Client.js` and
your hundreds of pages keep working.

This is the runtime shim Staticbot's Base44 → Supabase migration vendors into
your repo as the final step of the migration. You can also use it standalone
if you're doing the migration by hand.

## Dynamic Websites: the site client (`./site`, 0.9.0+)

A second, **visitor-side** entry for websites Staticbot replatforms onto
**Dynamic Websites** (its forms + public content backend, no SQL database).
It imports no database client, so a site's bundle never contains one. The
`@supabase/supabase-js` peer stays **required**, though. Every Base44 Edge Function
loads this package as `npm:@staticbot/base44-supabase-shim`, and Deno does not install
optional peers. 0.9.0 and 0.9.1 marked the peer optional, and every function built on
them failed to start (`BOOT_ERROR`). `tests/packaging.test.ts` keeps it required.

```js
// src/api/base44Client.js — what the DYNAMIC_SITE switchover writes
import { createSiteClient } from '@staticbot/base44-supabase-shim/site';

export const base44 = createSiteClient({
  endpoint: import.meta.env.VITE_STATICBOT_SITE_ENDPOINT, // https://app.staticbot.dev/api/sites/v1
  siteKey: import.meta.env.VITE_STATICBOT_SITE_KEY,       // ds_…
});
```

Everything else in your pages keeps calling `base44.entities.X.create(...)` /
`filter(...)` / `list(...)` / `get(...)` and
`base44.integrations.Core.SendEmail(...)`. What each surface does:

| Surface | Behaviour |
|---|---|
| `entities.X.create(data)` | POST. Resolves the created record; rejects with `Error` carrying `status`, `code`, `message`. |
| `entities.X.list(...)` / `filter(...)` | GET. Positional args or an SDK 0.8.49+ options object. Returns an array that also carries `items`, `next_cursor: null`, `has_more`. On 402 (site paused), 404 or a network error resolves `[]` and `console.warn`s once — public content keeps rendering. |
| `entities.X.get(id)` | GET `q={"id":…}`. The record, or `null` when absent; rejects with the server answer otherwise. |
| `integrations.Core.SendEmail(payload)` | POST `/notify`. Emails go **only to addresses the owner confirmed** — never to your visitors. `{}` on 202. |
| `auth.me()` / `isAuthenticated()` | No sign-in exists on this website: rejects `{status: 401}` / resolves `false`. |
| `auth.logout()` | Clears the SDK's localStorage keys and resolves. |
| anything else (`updateMany`, `functions.invoke`, `agents`, …) | Throws `SiteClientUnsupportedError` with the call path — loudly, never a silent no-op. |

## Install (automated path — done for you by Staticbot)

Staticbot's Base44 native migration vendors the prebuilt `dist/` directly into
your repo at `vendor/base44-supabase-shim/` and patches `package.json` to point
at it. You don't need to do anything manually — just merge the PR that lands
on the `staticbot/base44-switchover-<id>` branch.

## Install (manual)

In each consuming app, vendor the prebuilt tarball or add as a git submodule
(so builds don't depend on an npm registry):

```sh
# Option A: git submodule (you'll need to build it once locally)
git submodule add https://github.com/staticbot/staticbot-base44-supabase-shim.git vendor/base44-supabase-shim
cd vendor/base44-supabase-shim && npm i && npm run build

# Option B: vendor the prebuilt tarball straight from the npm registry
#   (same URL shape staticbot-app's Base44ShimProperties.getDistTarballUrl builds)
curl -L https://registry.npmjs.org/@staticbot/base44-supabase-shim/-/base44-supabase-shim-0.6.1.tgz \
    | tar -xz -C vendor/base44-supabase-shim --strip-components=1
```

In `package.json`:

```json
{
  "dependencies": {
    "@staticbot/base44-supabase-shim": "file:./vendor/base44-supabase-shim",
    "@supabase/supabase-js": "^2.45.0"
  }
}
```

## Use (browser / Vite app)

```js
// src/api/base44Client.js  — replace @base44/sdk import
import { createClient } from '@staticbot/base44-supabase-shim';

export const base44 = createClient({
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  schemaPrefix: 'propertyflow',          // app-specific schema
  sharedSchema: 'core',                  // shared entities live here
  // sharedEntities default: ['User','Role','UserRole','Department','Company','AuditLog']
});

// Then everything in your existing pages keeps working:
const customers = await base44.entities.Customer.list('-created_date', 50);
const c = await base44.entities.Customer.get('uuid');
await base44.entities.Customer.update('uuid', { phone: '081...' });
await base44.entities.Unit.create({ unit_no: 'A-101' });
```

## Use (Supabase Edge Function — Deno)

```ts
import { createClientFromRequest } from 'npm:@staticbot/base44-supabase-shim/server';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req, {
    supabaseUrl: Deno.env.get('SUPABASE_URL')!,
    supabaseAnonKey: Deno.env.get('SUPABASE_ANON_KEY')!,
    supabaseServiceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    schemaPrefix: 'propertyflow',
  });

  const customers = await base44.asServiceRole.entities.Customer.filter(
    {},
    '-created_date',
    50,
  );
  return new Response(JSON.stringify({ data: customers }));
});
```

## Entity → table mapping

Default rule: PascalCase → snake_case + plural.
- `Customer` → `customers`
- `ChartOfAccount` → `chart_of_accounts`
- `MeetingMinute` → `meeting_minutes`

Override via `entityMap` if a real table doesn't follow the rule:

```js
createClient({
  ...,
  entityMap: {
    Customer: { schema: 'core', table: 'customers' },        // explicit
    Job: { schema: 'construction', table: 'project_jobs' },  // non-default name
  },
});
```

## Filter syntax

```js
// Equality (default)
await base44.entities.Customer.filter({ status: 'active', vip: true });

// IN (pass array)
await base44.entities.Customer.filter({ id: ['a', 'b', 'c'] });

// Operators (Mongo-style, as Base44 apps write them)
await base44.entities.Invoice.filter({
  amount: { $gt: 1000 },
  customer_name: { $ilike: '%co.%' },
});

// Case-insensitive regex search (common in migrated server functions)
await base44.entities.Provider.filter({ name: { $regex: '^acme', $options: 'i' } });

// Presence check
await base44.entities.Profile.filter({ avatar_url: { $exists: true } });

// Boolean OR across sub-filters
await base44.entities.Argument.filter({
  $or: [{ created_by_id: userId }, { author_id: userId }],
});
```

Field operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$like`,
`$ilike`, `$regex` (+ `$options: 'i'`), `$exists`. Top-level combinators: `$or`, `$and`
(over an array of sub-filters; multiple fields within one sub-filter are AND-ed). The legacy
`{ op, value }` form is still accepted. `$nor`/`$not` and regex/like *inside* a `$or` group
throw a clear error rather than silently returning wrong rows.

## Order by

- String form (Base44 convention): `'name'` ascending, `'-created_date'` descending.
- Object form: `{ field: 'name', ascending: false }`.

## Paged reads, count and aggregate (Base44 SDK 0.8.49+)

- `list(options)` / `filter(query, options)` with an options object return one page,
  `{ items, next_cursor, has_more }`, instead of an array. Options: `sort` (default
  `'-created_date'`), `limit` (default 100, max 5,000), `cursor`, `fields` (`id` is always
  included). `{ distinct: 'field' }` returns the field's distinct values, ascending, with array
  fields contributing each element. The positional forms still return arrays. The page is
  itself the array of items, with `items` / `next_cursor` / `has_more` attached as
  non-enumerable properties: apps written against older SDKs passed the same options object
  (which those SDKs ignored) and use the result as an array, so both styles keep working.
- `count(query?)` returns the number of matching records.
- `aggregate({ query, groupBy, dateBucket, count, sum, avg, min, max, countDistinct, having, sort, limit })`
  returns `{ rows, truncated }` with Base44's row keys (`count`, `sum_<f>`, `avg_<f>`, ...).
  Supabase's PostgREST ships with aggregates disabled, so the shim reads the matching rows
  (only the columns the spec names) and groups them in the client. It stops reading at 50,000
  rows and then reports `truncated: true`. `dateBucket` groups by the bucket's start date
  (`YYYY-MM-DD`, UTC, weeks start Monday), stored under the date field's name.

## Updates, upsert and deletes (Base44 SDK 0.8.49+ / 0.8.53)

- `updateMany(query, update)` takes Base44's MongoDB update document: `$set`, `$unset`,
  `$currentDate`, `$inc`, `$mul`, `$min`, `$max`, `$addToSet` (with `$each`), `$push` (with `$each`,
  `$position`, `$sort`, `$slice`), `$pull` (value, `{ $in | $gt | ... }` predicate, or partial
  document) and `$rename`. A flat patch still works and means `$set`. One field may appear in one
  operator only; an unknown operator, or operators mixed with plain fields, throws.
- `$set` / `$unset` / `$currentDate` alone are a single PATCH over every matching row. Every other
  operator needs the current value, so the shim reads up to 500 matching rows and writes each back
  with a **compare-and-set**: the PATCH repeats the query and requires the columns it read to be
  unchanged; a row a concurrent writer changed first is re-read (jittered backoff) and retried. So
  `updateMany({ id, credits: { $gte: 5 } }, { $inc: { credits: -5 } })` never takes a balance below
  zero and concurrent `$inc`s never lose one. Like Base44, at most 500 rows per call — call again
  while `has_more`.
- The result is the updated rows (an array, as before) carrying Base44's `success`, `updated` and
  `has_more` as non-enumerable properties.
- `update(id, data)` accepts the same operators for one record.
- `upsert(records, { key })` (single field or array) updates the records whose key values match an
  existing row (merging the given fields) and creates the rest; the last record per key in one call
  wins. Returns `{ created, updated, records }`. Base44 enforces key uniqueness itself; a migrated
  table usually has no unique index on the key, so two *concurrent* upserts of a brand-new key can
  both insert. With a unique index the loser's 23505 is retried once and becomes an update.
- `deleteMany(query)` returns `{ success, deleted }`; `delete(id)` returns `{ success }`.

## Uploads

- `Core.UploadFile` / `Core.UploadPublicFile` return Base44's `{ file_url }` (plus `url` and `path`).
  Before 0.8.3 they returned only `{ url, path }`, and every app reading `file_url` stored `undefined`.
- `Core.UploadPrivateFile({ file })` uploads to `integrations.privateBucket` (default
  `<defaultBucket>_private`, which must exist and must not be public) under `<128 random bits>/<name>`,
  and returns `{ file_uri: 'supabase-storage://<bucket>/<path>' }`.
- `Core.CreateFileSignedUrl({ file_uri, expires_in })` returns `{ signed_url }` (60–3600 s, default 300).
  As on Base44, holding the `file_uri` is what grants access. So the private bucket has no read policy:
  a read policy would also let every user list the bucket. User clients sign through
  `integrations.signFileFunction` (Staticbot deploys `staticbot-file-signer`), which signs with the
  service role for signed-in callers. `asServiceRole` and `createClientFromRequest(...).asServiceRole`
  sign directly. Without `signFileFunction` every client signs directly (0.8.4 behaviour). A `file_uri`
  from Base44 itself is not in Supabase Storage and is rejected with that reason. (0.8.5)
- Any other `Core.<Endpoint>` rejects with "not available after migrating off Base44" instead of a
  `TypeError`.

## Realtime (`entities.X.subscribe`)

`subscribe(callback)` delivers the SDK's events over Supabase Realtime and returns an unsubscribe
function:

```js
const unsubscribe = base44.entities.RideMessage.subscribe((event) => {
  event.type;       // 'create' | 'update' | 'delete'
  event.data;       // the row
  event.id;         // the row's id
  event.timestamp;  // commit time, ISO string
});
```

Before 0.8.8 it passed Supabase's `{ type: 'insert' | ..., new, old }`, so `event.data` was undefined
and `type === 'create'` never matched. `new` and `old` are still there.

- The table must be in the `supabase_realtime` publication. Staticbot's migration adds every entity
  table; on your own project, run `alter publication supabase_realtime add table <schema>.<table>`.
- A delete's `data` is only `{ id }`. Supabase sends just the primary key of a deleted row, and
  deletes are not filtered by RLS.
- Inserts and updates reach a subscriber only if RLS lets that user read the row.

## Backend functions

`functions.invoke(name, params)` calls the Supabase Edge Function `name` and, like the SDK, resolves
to the whole response, so app code reads the function's reply as `res.data`:

```js
const res = await base44.functions.invoke('affiliatePortal', { action: 'get_config' });
res.data.client_id;   // also: res.status, res.statusText, res.headers
```

Before 0.8.7 it resolved to the bare body, so every `res.data` read `undefined`.

- A non-2xx reply rejects like the SDK's axios error: `err.response.status`, `err.response.data` (the
  function's body, parsed when it is JSON), `err.message` = `Request failed with status code <n>`,
  `err.isAxiosError`, `err.code`. An unreachable function rejects with `Network Error` and no
  `response`. The error class is exported as `FunctionInvokeError`.
- A body that is valid JSON is parsed whatever its Content-Type, as axios does.
- A params object holding a `File` goes as `multipart/form-data` (nested objects JSON-encoded), as in
  the SDK. A string instead of an object is refused with the SDK's message.
- Same shape on `asServiceRole.functions` and on `createClientFromRequest(...)` in Deno.
- `functions.fetch(path, init)` returns the raw `Response` (streams, non-POST, binary); `path` may
  start with `/`.

## The User entity and `auth.me()`

Base44's `User` entity maps to the shared `core.users` table (Staticbot's migration exposes the `core`
schema and gives it Base44's User rules: a user sees and edits their own row, an admin all rows, and
only an admin can change a role). `auth.me()` / `getUser()` build the user from, in rising precedence:
`user_metadata` → `app_metadata` → the signed-in user's own row. The row is authoritative for every
column it has, NULL included, so `me().role` is the same role the database's RLS checks — including
after an admin changes it. `user_metadata` is writable by the user (`signUp({options: {data}})`), so
its keys are only lifted when the target's `staticbot_user_field_policy()` RPC (emitted by the
migration DDL) lists them as editable; a missing or invalid policy exposes no metadata fields at all,
and `app_metadata` (service-role only) remains the trusted fallback. `auth.updateMe()` stores only
those same policy-approved fields in `user_metadata`, mirrors the ones that are columns of the row,
and warns while dropping anything else (never `id`, `email`, `role` or system columns). If the policy
can't be read it throws `ProfilePolicyUnavailableError` (`code: 'PROFILE_POLICY_UNAVAILABLE'`,
`retriable: true`) rather than reporting a save that stored nothing. An accepted write is visible
through a later `me()` only when the row mirror also succeeds — the row stays authoritative, so its
pre-write value wins if that update fails (Supabase's auth trigger normally keeps row and metadata in
sync). Pass `authOptions: { usersTable: null }` to opt out of the row overlay and the policy lookup;
with no policy, `updateMe()` stores key/value pairs unchanged, and they are readable from
`user_metadata` but not lifted to the Base44 top level.

On the service-role path `asServiceRole.entities.User.delete(id)` also deletes the auth account
(`auth.admin.deleteUser`): Base44's `User.delete` deletes the account, and the migration's FK
cascades only `auth.users → core.users`, so without it the login — the email code, and any
configured provider — outlives the profile row. The browser client has no admin access, so its
`User.delete` keeps the row delete RLS lets it make. A profile row whose auth account is already
gone (`user_not_found` / 404) counts as deleted; any other admin error throws rather than leaving
a login silently behind. `deleteMany` stays row-only.

## Creating records

Base44 fills `id`, `created_by_id` and `created_by` on its servers and returns the created record
whatever the entity's read rules say. `create()` / `bulkCreate()` keep that contract:

- The plain insert runs first. Tables created by Staticbot's DDL carry column defaults for all three,
  so it normally succeeds as is.
- On an older target (no defaults), a row-level-security refusal is retried with `created_by_id` /
  `created_by` taken from the signed-in session, and a not-null error on `id` with a Base44-shaped
  24-hex id.
- If the new row can't be read back (INSERT … RETURNING applies the SELECT policy — e.g. an
  admin-only activity log), the insert is retried without RETURNING and the submitted row is returned
  with a client-side id.

A failed insert writes nothing, so retries never duplicate. A refusal that survives every step throws
the original error. Without a session (service role, anonymous) nothing is stamped.

## Auth surface

Base44 alias names are supported alongside Supabase-idiomatic ones so migrated
apps compile unchanged:

- `auth.signIn({email, password})` / `auth.loginViaEmailPassword(email, password)`
  — on invalid credentials both keep the Supabase error (type, status, `code`) but
  its message points imported users to "Forgot password?" (`MOVED_APP_PASSWORD_HINT`, 0.9.1): users
  migrated from Base44 have no password until they set one.
- `auth.signUp({email, password, metadata?, emailRedirectTo?})` / `auth.register({email, password, metadata?, emailRedirectTo?})`
- `auth.loginWithProvider(provider, returnPath?)` — Google / Microsoft / Facebook / Apple; builds an absolute `redirectTo` from `window.location.origin`.
- `auth.verifyOtp({email, otpCode})` — email OTP after `register()`. Returns `{access_token, session, user}`; the Supabase session is installed as a side-effect so a follow-up `setToken()` is a no-op.
- `auth.resendOtp(email, {emailRedirectTo?})`
- `auth.setToken(accessToken)` — kept as a warn-once no-op so migrated code doesn't `TypeError`; the session is already installed by `verifyOtp` / `signInWithPassword`.
- `auth.resetPasswordRequest(email, {redirectTo?})` — Supabase `resetPasswordForEmail`.
- `auth.resetPassword({resetToken, newPassword})` — `resetToken` is ignored (Supabase already exchanged the link fragment for a session before you got here).
- `auth.isAuthenticated(): Promise<boolean>`
- `auth.hasToken(): boolean` / `auth.getAccessToken(): string | null` (0.9.3) — synchronous, like Base44
  SDK 0.8.5x's `auth.hasToken()` and top-level `getAccessToken()`: the access token of the session
  supabase-js persisted for this client (its own storage key, `sb-<project>-auth-token`); on a client
  built from a request (a supabase-js client with a global `Authorization` header), the request's bearer
  token. False/null otherwise, including when the browser blocks storage. Base44's TanStack Start
  scaffold calls `hasToken()` before `me()` and sends `getAccessToken()` as `Authorization: Bearer …`
  to its server functions. On such a request-scoped client `isAuthenticated()` validates the bearer
  token through `getUser()`, the same path as `me()`, since there is no stored session.
- `auth.logout(returnUrl?)` — after signOut resolves, navigates to `returnUrl` if provided.
- `auth.me()` / `auth.updateMe(metadata)` / `auth.getUser()` / `auth.getSession()` / `auth.redirectToLogin(returnUrl?)` / `auth.onAuthStateChange(cb)`
  — `me()` / `getUser()` reject a missing session with `status: 401` (0.9.3; supabase-js says 400),
  because Base44 app code reads 401/403 as "signed out" and anything else as an outage.
- `app.getPublicSettings()` — resolves `{ id: null, public_settings: {} }`. Newer Base44 scaffolds await it in `AuthContext` before checking the session; there are no Base44 app-level settings on self-host, so the stub just lets that gate pass.

### Auth callbacks on hosted domains

Signup (`signUp` and `register`), confirmation resends and password reset default to the current
browser origin's root. Staticbot does not generate a password-reset route. The application must
handle the recovery session or supply its own reset page through `redirectTo` per call or
`authOptions.resetPasswordRedirect` per client. For confirmation/resend callbacks, use
`emailRedirectTo` per call or `authOptions.signupRedirect` per client. Per-call values take priority.

Relative paths resolve against the current browser origin. Outside a browser, or with an opaque
origin such as a sandboxed iframe, no default redirect is sent; explicit callbacks must be absolute
URLs, and relative values throw a clear error before making a request. Set a callback to `''` to
omit it deliberately and use Supabase's Site URL, including in a browser.

Callbacks must be allowed in the Supabase project's Auth URL configuration. If a requested URL is
not allowed, Supabase can silently use Site URL instead; a successful signup/resend API response
does not prove which host its email link targets. Staticbot's additive registration reconciler covers
eligible completed launch-stack deployments and attached migration previews with verified backend
wiring. Feature-branch previews and other origins need separate allow-list configuration. Registration
preserves the canonical Site URL. Email templates must honor `ConfirmationURL` or `RedirectTo`
instead of hardcoding an old host or `SiteURL` in their confirmation/recovery link.
See [Supabase redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).

## Agents

`base44.agents.*` (Superagents) runs on the **Staticbot AI agent runtime** in your own Supabase
project: conversations and messages live in the `staticbot_ai` schema (each user sees only their
own), and the `staticbot-agents` edge function runs the agent's tool loop against any
OpenAI-compatible AI provider. Tools run with the signed-in user's permissions, so row-level
security applies to everything an agent reads or writes.

Supported, in the SDK's shape so existing UI code works unchanged:
`listConversations({ agent_name })`, `getConversations()`, `getConversation(id)`,
`createConversation({ agent_name, metadata })`, `addMessage(conversation, { role, content })`,
`subscribeToConversation(id, onUpdate)` (Supabase Realtime; replies stream in as the agent works).

`addMessage` resolves once the message is stored; the reply arrives through
`subscribeToConversation` (or the next `getConversation`).

WhatsApp / Telegram bridges aren't part of the runtime. Their connect URLs return `null` unless
configured, so `<a href={...}>` renders as an inert link:

```js
createClient({
  ...,
  agents: {
    functionName: 'staticbot-agents', // default
    schema: 'staticbot_ai',           // default
    whatsappUrls: { SubdomainReviewer: 'https://wa.example.com/connect' },
    telegramUrls: { Hilton: 'https://t.me/hilton_bot' },
  },
});
```

## Per-user connectors (`connectAppUser`, `getCurrentAppUserConnection`)

Base44's app-user connectors let each user link their own Google Calendar, Gmail, Dropbox and so on. Here the
app's own Supabase project holds those connections: Staticbot installs a `staticbot-connectors` edge function
(and a private `staticbot_connectors` schema) that runs the OAuth flow on **your** OAuth app and keeps each
user's tokens encrypted. Base44's tokens can't be exported, so every user connects once after the move.

| Call | Where | Does |
|---|---|---|
| `connectors.connectAppUser(id)` | browser | Resolves to the provider's consent URL; open it in a popup (or navigate). The provider comes back to the current page |
| `connectors.disconnectAppUser(id)` | browser or function | Revokes at the provider and forgets the connection |
| `asServiceRole.connectors.getCurrentAppUserConnection(id)` | function | `{ accessToken, connectionConfig: null }` for the **caller**, refreshed when about to expire |
| `asServiceRole.connectors.getCurrentAppUserAccessToken(id)` | function | Deprecated alias: the token string |

These always act as the caller — the browser session, or in an edge function the client carrying the request's
`Authorization` header — even under `asServiceRole`, as on Base44. `createClient` finishes the flow when the
page loads with `#staticbot-connect=ok` (closes the popup, or strips the marker) or `…=error&reason=…` (shows a
small notice); call `completeConnectorRedirect()` yourself if your app builds the client later.

Failures throw `ConnectorError` with a `code`: `CONNECTOR_NOT_CONNECTED`, `CONNECTOR_RECONNECT_REQUIRED`,
`CONNECTOR_NOT_CONFIGURED` (unknown connector, missing or rejected OAuth client, origin not allowed),
`CONNECTOR_NOT_SIGNED_IN`, `CONNECTOR_BUSY`, `CONNECTOR_PROVIDER_ERROR`, `CONNECTOR_UNREACHABLE` (network or
CORS), and `ConnectorUnavailableError` (`CONNECTOR_UNAVAILABLE`) when the project has no `staticbot-connectors`
function.

## What's NOT covered

- **Stripe / payments** — Base44 had managed integration; here, wire Stripe into
  edge functions yourself.
- **Email** — air-gapped LAN can't send mail by default; supply an internal
  SMTP relay or capture via inbucket. Enable via `integrations.sendEmailFunction`.
- **AI / `InvokeLLM` / `GenerateImage`** — opt-in only. Wire your own endpoint
  through an edge function and pass its name via `integrations.invokeLlmFunction`
  / `integrations.generateImageFunction`.
- **`SendSMS` / `ExtractDataFromUploadedFile`** — opt-in edge functions
  (`integrations.sendSmsFunction` / `integrations.extractDataFunction`). Both are
  implemented as methods that throw a clear "not configured" error when unset, so a
  migrated app that calls them fails legibly instead of hitting an `undefined` TypeError.
- **`connectors.getWorkspaceConnection`** — Base44's workspace-level connection has no equivalent; it throws
  `ConnectorUnavailableError` (`code: 'CONNECTOR_UNAVAILABLE'`), as does any connector method the shim doesn't
  know.
- **`Core.SendPushNotification`** — Base44's push service has no equivalent; it throws like every
  other unknown `Core.*` endpoint.
- **`importEntities`** (CSV/file import) — not implemented.
- **Schema discovery** — entity definitions must exist in Postgres first
  (separate migrations). The shim assumes tables exist with conventional names.

## Test

```sh
npm i
npm test       # vitest, mocked SupabaseClient + real postgrest-js over a fake fetch
npm run build  # tsup → dist/
```

The `./site` bundle check (`tests/site.test.ts`, last block) reads `dist/site.js`
**after a build** — it skips with a warning on a fresh checkout and runs for real
in `prepack`, which builds before running the tests.

`tests/entities.e2e.test.ts` runs `create()` against a real Postgres + PostgREST (RLS ordering,
RETURNING vs the SELECT policy and `missing=default` are server behaviour no mock can prove). It is
skipped unless pointed at one:

```sh
docker network create shimnet
docker run -d --name shimpg --network shimnet -e POSTGRES_PASSWORD=pw \
  -v "$PWD/tests/e2e/init.sql:/docker-entrypoint-initdb.d/init.sql" postgres:16
docker run -d --name shimrest --network shimnet -p 3999:3000 \
  -e PGRST_DB_URI=postgres://authenticator:pw@shimpg:5432/postgres -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=a-string-secret-at-least-32-bytes-long-xx \
  postgrest/postgrest:v12.2.3
SHIM_E2E_PGRST_URL=http://localhost:3999 SHIM_E2E_JWT_SECRET=a-string-secret-at-least-32-bytes-long-xx \
  npx vitest run tests/entities.e2e.test.ts
```
