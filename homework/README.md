# KSA Homework site

A separate website for Gemara homework. Students sign in with Google, answer the questions, record a voice memo, and submit. The recording is saved and transcribed with your existing Whisper proxy. You see everything on the teacher page.

- Teacher page: `https://ksa-homework.web.app/teacher` (make assignments, see submissions)
- Student links look like `https://ksa-homework.web.app/?a=<assignment id>`. The teacher page gives you each one.

It uses the same Firebase project as the KSA app (`kitzur-app1`), so it shares sign-in, your `teachers` record, and your class rosters. It doesn't change any KSA app code.

## One-time setup

Run these in Terminal from inside this folder (`cd`, a space, then drag the folder in, then Enter).

### 1. Create the new site

```
firebase hosting:sites:create ksa-homework --project kitzur-app1
```

If it says the name is taken, pick another name (like `rasg-homework`). Then put that name in `firebase.json` (the `"site"` line) and `cors.json`.

### 2. Allow audio uploads

Go to the Firebase console, open **kitzur-app1**, then **Storage**, then the **Rules** tab. Paste the block from `storage-rule-to-add.txt` inside the existing `match /b/{bucket}/o { ... }` block, next to the `class-files` rule. Don't remove anything. Click **Publish**. If it asks to let Storage rules read Firestore, say yes. That's how it knows you're a teacher.

### 3. Allow Google sign-in on the new address

In the same project: **Authentication**, then **Settings**, then **Authorized domains**. Click **Add domain** and add `ksa-homework.web.app`.

### 4. Make iPhone recordings transcribe

iPhones record in a different audio format than Chrome. Your Railway proxy currently labels every file as `.webm`, which can make Whisper reject iPhone recordings. In the **ksa-app** repo, in `server.js`, inside `app.post('/api/whisper', ...)`, replace these two lines:

```js
    const blob = new Blob([req.file.buffer], { type: 'audio/webm' });
    form.set('file', blob, 'audio.webm');
```

with:

```js
    const type = req.file.mimetype || 'audio/webm';
    const name = req.file.originalname || 'audio.webm';
    const blob = new Blob([req.file.buffer], { type });
    form.set('file', blob, name);
```

Then commit and push so Railway redeploys. The KSA app keeps working the same, since it already sends `recording.webm`.

### 5. Put the site online

```
firebase deploy --only hosting
```

### 6. (Optional) Turn on the "Transcribe now" button

If a transcript fails, the teacher page has a "Transcribe now" button. For it to work, the storage bucket has to let the site download audio. This needs the Google Cloud command line tool (`gsutil`) installed once:

```
gsutil cors set cors.json gs://kitzur-app1.firebasestorage.app
```

Everything else works without this step. Recordings are always saved and playable on the teacher page.

### 7. Test it

Open the teacher page, sign in, and press **Copy student link** on the Kiddushin 29a assignment. Open that link, answer, record 10 seconds, and submit. Back on the teacher page, under **Submissions**, you should see your submission with the audio and transcript. Then try **New assignment** with a short piece of Gemara.

## Making an assignment

1. Open the teacher page and go to **Assignments**, then **New assignment**.
2. Paste the Gemara text. Add the translation if you have it: students don't see it, but Claude is much more accurate with it.
3. Say what it should focus on (for example "reading, the concept, the circular logic in the answer"), pick the level and question types, and press **Draft it with Claude**. It takes 30 to 60 seconds.
4. Read every question. Edit anything directly, or type a change into **Ask Claude to change something**. The yellow box flags problems like a correct answer that's the longest choice. The blue box lists the claims Claude says to check against the text.
5. **Preview as a student** opens it the way students see it. Students can't open it until you publish.
6. **Publish**, then **Copy student link** and post that one link in Google Classroom.

Every assignment, including the built-in Kiddushin one, has an **Edit** button. In the editor, the voice memo section has a checkbox for whether students do it first (read and explain the Gemara, then the questions) or last.

Assignments live in the database, so you never touch code to add one. Multiple-choice answers are shuffled automatically so the correct letter is random. You can edit a published assignment any time. **Unpublish** hides it again.

Drafting uses the `/api/claude` route on your Railway proxy. The model is set in `public/firebase.js` (`CLAUDE_MODEL`).

## Seeing submissions

**Submissions** tab: pick the assignment and, optionally, a class to see who hasn't submitted. Click a student to see their answers (auto-checked), play the recording, and read the transcript. **Download CSV** gives you scores and transcripts for everyone.

## Where things are stored

- Assignments: Firestore collection `homeworkAssignments`. The original Kiddushin 29a assignment is built into `public/assignments.js`.
- Answers and transcripts: Firestore collection `homeworkSubmissions`, one document per student per assignment.
- Recordings: Storage folder `homework-audio/<assignment id>/<student email>`.
- If a student submits again, the new submission replaces the old one.

## If something goes wrong

- **"Couldn't draft it"**: open `https://ksa-app-production.up.railway.app` to check the proxy is up. If the error mentions the model, change `CLAUDE_MODEL` in `public/firebase.js` to the model your KSA app uses and deploy again.
- **"Sign-in didn't work"**: step 3 wasn't done, or the browser blocked the pop-up.
- **Upload fails with `storage/unauthorized`**: step 2 wasn't done, or the rules weren't published.
- **`firebase` command can't find kitzur-app1**: run `firebase projects:list` to see which projects your login can deploy to. If only `kitzur-app` shows, you can host on that instead (change `.firebaserc` to `kitzur-app` and use `--project kitzur-app` in step 1). Steps 2 and 3 still go in **kitzur-app1**, because that's where sign-in and storage live.
