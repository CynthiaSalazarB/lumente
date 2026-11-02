# Lumente demo video: the final cut

The demo video for Devpost (#48), finished Oct 25: **3:14.5**, 1920 x 1080, 30 fps, under the 3:15 ceiling
in Cynthia's brief ("Lumente video brief without narration") and Devpost's four minutes. Kyle's talking-head
opening comes first and is the only spoken part; the walkthrough after it has no narration and reads with
the sound off. The MP4 is with the team, not in the repo (the link goes in `docs/devpost.md`); the
walkthrough rebuilds from one edit file with the demo-reel skill.

Nothing in the app, the API or the agents was changed for it, and nothing was published or deployed.

## What's in it

| Time | Part | Footage | Text on screen |
|---|---|---|---|
| 0:00 | Kyle's opening | His recorded take, with his own captions | Three cards beside him: "The illusion of explanatory depth" (0:16), Anthropic's study, 50% with an AI assistant against 67% coding by hand (0:32), and the firefly, "Lumente" and "Build with AI. Understand the concepts yourself." (0:38) |
| 0:48 | Title | | Lumente is a gym for questioning. |
| 0:52 | Account | The live sign-in page, signed out, empty fields | Your practice stays with your account. · Clerk handles sign-in. |
| 0:58 | Start | Start with API, newest UI | Pick a concept from your code. / Today: API. The concept is the equipment. |
| 1:04 | The method | Start's empty map, enlarged; each area lights with its question | Conceptual Mentefact / Four places where questions start. The four questions one at a time, then "Questions to ask, not answers to memorize." and the credit line |
| 1:20 | Prediction | 7, "Save my prediction" | How much can you explain on your own? / Four areas. Up to 2 points each. |
| 1:28 | Explanation | "Your first explanation", Send, Continue, the first area question | You explain. The AI asks. · Claude agents ask questions and evaluate answers. |
| 1:37 | Support | "A server?", the free nudge, the Help sheet, the hint (zoomed) | Support when you need it. / The score reflects what you can explain independently. |
| 1:53 | Guidance fades | "A software interface.", its feedback, Category lights | As you get stronger, the guidance fades. |
| 2:03 | Level 5 | Cynthia's recording at lumente.expo.app, laptop layout, CORS in Test myself: the whole map written, a fact asked and answered, "What is CORS a kind of?" and the redirect, the last area, Review & submit, Submit my map | Level 5: you ask the questions. Then one at a time: You write the whole map. / Ask for facts, not answers. / The map is yours to build. (· Code enforces the map-seeking redirect.) / Explain it in your own words. / Then submit the whole map. Note: Shown with Test myself, the same independent mode. |
| 2:32 | Result | That session's result: 7 predicted, 5 of 8 proved, zoomed on the two rows | Compare your prediction with your explanation. · AI evaluation. Scoring rules in code. |
| 2:39 | Memory | Account, then the Memory sheet ("Last time, Oct 25: you guessed 7 and proved 5.") | Every session builds on the last. · SurrealDB Agent Memory / Progress notes, not answer text. |
| 2:48 | Web | Start in the laptop layout, the Account menu | One app on Android and the web. / Publish the web app. · Expo · EAS Hosting |
| 2:55 | Android | The installed APK on an Android emulator: the home screen, the icon, the landing screen | Same headline / Build the Android app. · EAS Build |
| 3:02 | Android | "Your data" on the signed-in app, zoomed on "Lumente 1.0.0 · update 01a17590 from Oct 25, 8:15 PM · preview" | Same headline / Send fixes without reinstalling. · EAS Update |
| 3:10 | End card | | Lumente / Curiosity. Questions. Understanding. / lumente.expo.app / the music credit |

## Chapters, for the video description

```
0:00 Why we built Lumente
0:48 Sign in and pick a concept
1:04 The four questions
1:20 Predict, then explain
1:37 Support when you need it
1:53 The guidance fades
2:03 Level 5: you ask the questions
2:32 Result and memory
2:48 One app on Android and the web
```

The description also needs the music credit: **Music: Sascha Ende, ende.app (CC BY 4.0)**.

## What the footage is

- **Every screen is real and labelled.** Phone-sized scenes: "Recorded app session · demo mode · web app"
  (a demo-mode export of `main` at `683b46e`, the newest UI). Level 5, the result, Memory and the web
  scene: "Recorded app session · web app" (Cynthia's recordings of the live site). Android: "Recorded on an
  Android emulator" (the team's APK with its latest update).
- **Level 5 is shown with Test myself**, which runs the same independent mode on any concept, so the note
  says so instead of the brief's "Prepared level 5 account".
- No email, code, inbox or private dashboard is on screen. The recordings' sign-in steps are cut out.

## Where the cut differs from the brief

- **Captions reframed** to Cynthia's final prompt: Lumente as a gym for questioning, the concept as the
  equipment, the four parts as where questions start, level 5 as the payoff. The brief's support and
  scoring wording stays as written.
- **The method's name** is "Conceptual Mentefact", as the brief's wording section asks (its storyboard
  said "Mentefacto conceptual"); a one-line change if it should switch.
- **The area labels** in the app (Category, Similar concepts & differences, Defining features,
  Classification) stay as they are; the overlays use the brief's four questions.

## An app quirk seen while recording

After "Start with guidance" or "Continue self-test" on the web, Start paints a blank frame for about
0.3 s while the next screen loads; in Cynthia's recording the button also greys out first. The cut steps
around those frames; a live demo would show them.

## Sound

Kyle's voice, with a quiet music bed under it; the walkthrough's music (Sascha Ende, "Happy Beats /
Business Moves", CC BY 4.0) with sound effects made in code (soft whooshes on cuts, the same neutral tick
on every tap, Help included; no warning or point-loss sound). Loudness -16 LUFS, peaks under -1.5 dB.

## Checked

The walkthrough passed every check of the build: size, frame rate, duration, loudness, true peak, no
silence over 1.5 s, no black frames, picture and sound in sync (within a frame). The joined video was
checked for black frames, loudness and the join itself (Kyle's last word ends before the fade).
Not checked: a person watching the whole video with the sound on.
