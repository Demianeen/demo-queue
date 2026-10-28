# Invitation sign-in fix

28 October 2026. This report supersedes the earlier invitation-link check.

## Reproduced failure

The valid Production invitation reached WorkOS. WorkOS stored its invitation
context in the secure `initiate_login_context` cookie, then redirected to the
configured app homepage. The homepage redirected to `/events`.

The app's Google button starts an authorization request with
`provider=GoogleOAuth`. That path bypasses the AuthKit bootstrap that consumes
WorkOS's invitation context. WorkOS rejected the subsequent first signup with
`sign_up_not_allowed`. Both invitations and memberships remained pending.

The first check verified only the invitation's first redirect. It did not
follow the complete invitation-to-sign-in flow.

## Correction

`/events/sign-in/initiated` starts the SDK's AuthKit flow and establishes its
PKCE verifier and sealed OAuth state. WorkOS consumes its own context cookie
and attaches the invitation to the authorization session. The existing
callback verifies state and PKCE and saves the resulting session.

The normal Google button continues to use `/events/sign-in`. Public signup
stays disabled. Organization membership still controls access. No invitation
is accepted administratively and no invitation token is stored by the app.

## External configuration after deployment

Set the Production application's initiate-login URI to
`https://demo-queue-tau.vercel.app/events/sign-in/initiated`.
Set the development application's URI to
`http://localhost:3001/events/sign-in/initiated` for local verification.
The application's homepage and callback URLs have separate purposes and do
not need to change. Convex's `authKit.configure` does not manage this setting.

Check the full redirect chain, including the AuthKit bootstrap's invitation
token, rather than only the first 307. Complete Google sign-in from the actual
email link to verify invitation acceptance and organization access.

References: [WorkOS initiate-login URI](https://workos.com/docs/sdks/authkit-nextjs)
and [invitation lifecycle](https://workos.com/docs/authkit/invitations).

## Verification

- Before the fix, the initiated route returned 404. After the fix, the actual
  local route returned 307 with `provider=authkit`, state, a PKCE challenge,
  its matching verifier cookie, and `Cache-Control: no-store`.
- The normal route still returned `provider=GoogleOAuth` with PKCE and state.
- Using the real Production invitation context, the AuthKit authorization
  request reached `/bootstrap` with `invitation_token`. The direct Google
  authorization request skipped that bootstrap.
- All 134 Node tests, TypeScript, and the route's ESLint check passed.
  An independent read-only review found no material issues and passed all
  17 focused authentication tests.
- Production invitation acceptance and authenticated organization access
  require the deployed fix and a completed Google sign-in. They are not
  established by these redirect checks.
