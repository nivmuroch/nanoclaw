# Task 02: Test Own LID Session Survives Startup Cleanup

## Phase
Test (2 of 2)

## Objective
Add a test to `whatsapp.test.ts` that verifies the own LID session file is NOT deleted
during the stale session cleanup, while other session files still are.

## Files to Modify
- `src/channels/whatsapp.test.ts` — add test for own LID session preservation

## Implementation Steps
1. Find the existing section that tests `connectInternal` / stale session cleanup (search for `onFirstOpen` or `staleFiles` or `Cleared stale signal sessions`). If none exists, add a new `describe` block.

2. Add a test that:
   - Creates a temp auth dir
   - Writes a fake `creds.json` with `me.lid.user = "111222333"`
   - Writes session files: `session-111222333-13@lid` (own), `session-other-999@s.whatsapp.net` (foreign)
   - Triggers a fresh connect (with `onFirstOpen`)
   - Asserts the foreign session file is deleted
   - Asserts the own LID session file (`session-111222333-13@lid`) still exists

   ```ts
   it('preserves own LID session file during stale session cleanup', async () => {
     // Write fake creds with own LID
     const authDir = /* get the auth dir used by the channel in tests */;
     fs.mkdirSync(authDir, { recursive: true });
     fs.writeFileSync(
       path.join(authDir, 'creds.json'),
       JSON.stringify({ me: { id: '111222333:13@s.whatsapp.net', lid: { server: 'lid', user: '111222333' } } }),
     );
     // Write session files
     fs.writeFileSync(path.join(authDir, 'session-111222333-13@lid'), '{}');
     fs.writeFileSync(path.join(authDir, 'session-other-999@s.whatsapp.net'), '{}');

     // Trigger fresh connect
     const opts = createTestOpts();
     const channel = new WhatsAppChannel(opts);
     await connectChannel(channel); // triggers onFirstOpen cleanup

     expect(fs.existsSync(path.join(authDir, 'session-111222333-13@lid'))).toBe(true);
     expect(fs.existsSync(path.join(authDir, 'session-other-999@s.whatsapp.net'))).toBe(false);
   });
   ```

3. Check how `authDir` is determined in tests (look for `STORE_DIR` or `tmp` dir setup in the test file) and adapt accordingly.

## Test Command
```bash
npm test -- --testPathPattern=whatsapp --testNamePattern="preserves own LID"
```

## Dependencies
- **Requires**: Task 01 (the fix must be in place for this test to pass)
- **Blocks**: Nothing

## Status
- [ ] Implementation complete
- [ ] Tests passing

## Notes
- Check how the test mocks `fs` — if it uses a real temp dir, the test above works directly. If `fs` is mocked, adapt accordingly.
- Look at the test file around line 171 (`connectInternal completes`) for existing auth dir setup patterns.
