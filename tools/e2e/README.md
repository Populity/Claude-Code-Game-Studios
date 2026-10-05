# VSV live end-to-end checks

Headless Chrome (Playwright) against the live server. Each script creates throwaway
`qa_*` accounts and deletes them at the end (DELETE /api/me also removes their clips).

```
npm i playwright@1            # in a scratch folder; uses the installed Chrome (channel "chrome")
node flow.mjs                 # onboarding → battle → vote → explore / ranking / profile
node upload.mjs               # records a 2 s webm in the browser, uploads it via the Create sheet
node play.mjs                 # another user sees that clip in a battle and the <video> plays
```
Screenshots go to `shots/`; copy the ones a story needs into `production/qa/evidence/`.
