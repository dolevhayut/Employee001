# Recording the 60-second hero GIF (task #1221)

A real screen recording is the only honest way to show the path from `npx employee001` to a first answer. This sandbox cannot make one, so this page says exactly what to record and where to save it.

**Save the file as:** `docs/screenshots/first-answer.gif`
**Length:** 60 seconds or less. **Size:** 8 MB or less, so GitHub renders it inline (aim for about 900 px wide, 10-12 fps).

## Before you start

- Use a throwaway folder and a fresh browser profile with no extensions, so no real names, tabs, bookmarks or notifications show.
- Turn on Do Not Disturb. Use the dark or light theme you want on the README.
- Never show `.env*`, an API key, a token or a real email address. If setup asks for a key, use the Claude subscription option or cut that moment.
- Use only the invented company, Lumen Labs. Do not record your own twin data.
- Unset `ANTHROPIC_API_KEY` in the terminal before you start.

## Script (about 55 seconds)

1. **0-10 s, terminal.** Type `npx employee001` so the command is visible, then run `npx employee001 demo` (a made-up company, no keys). Let the "opening http://localhost:..." line show, then the browser opens.
2. **10-25 s, Build my twin.** In the browser open **Build my twin** from the Launchpad. Click **Interview me**, answer the first question with a short invented line (for example "I run revenue operations at Lumen Labs"), and show the profile files being written. If the demo does not support the builder, record this step on a separate throwaway install with the Claude subscription option and only invented text.
3. **25-50 s, Ask with sources.** Open **Ask**, pick a Lumen Labs twin (Theo), and click the suggested question "Who approves a 20% discount now?". Hold on the answer so the **sources** and the run graph are readable for at least 4 seconds.
4. **50-55 s.** Stop on the answer. Do not scroll.

## Record and convert

Any recorder works (QuickTime, Kap, ScreenToGif). With ffmpeg:

```bash
ffmpeg -i raw.mov -vf "fps=10,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" -t 60 docs/screenshots/first-answer.gif
```

Check: `ls -lh docs/screenshots/first-answer.gif` shows 8 MB or less, and the GIF plays for 60 seconds or less.

## Then

Commit the GIF, then ask the dev agent to embed it. The embed replaces the still image in the README hero (the `<p align="center">` block under the badges):

```html
<p align="center">
  <img src="docs/screenshots/first-answer.gif" width="900" alt="From npx employee001 to a first twin answer in under 60 seconds: setup, Build my twin, then Ask returns an answer with its sources" />
</p>
```

Task `tsk_ma3qdsgyje` also edits the hero, so merge it first or resolve the overlap by hand.
