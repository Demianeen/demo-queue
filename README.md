# Demo Queue

Realtime demo-night picker for events.

## Stack

- Next.js
- Convex
- Secret-link access for admins and participants
- Manual Google Meet link for v1

## Local setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Start Convex:

   ```bash
   pnpm convex:dev
   ```

3. In another terminal, start Next.js:

   ```bash
   pnpm dev
   ```

4. Open `http://localhost:3000`.

## Manual test cases

1. Create an event from `/`, paste a fake Meet link, and open the generated admin and stage links.
2. Submit two demos from the QR/form link and confirm they appear in the admin queue without showing contact info on the stage screen.
3. Hide one queued demo from admin and confirm another eligible demo fills the queue gap when available.
4. Publish the queue, click `Advance`, and confirm the stage screen updates, the participant page reveals the Meet link for everyone in the published lineup, and the stage shows the Meet link only after `Show on stage` is enabled.
5. Try opening the admin route with a changed token and confirm it does not return admin data.
