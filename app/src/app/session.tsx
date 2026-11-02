// The session (#6, #7, round 9 "Lumente"): the guess, then the work (the map in the light the learner has earned,
// the firefly's question with the part it asks about, and the one input the latest Turn asks for, or at level 5
// the whole map with the fact desk), then the result. A single route with no id in the path, so the web build
// stays static (decision 14, #27). Closing saves: the start screen offers to resume. In the website layout the
// conversation is a column on the left, under its pinned question, and the map stands on the right, where the
// light falls; the firefly's line runs across the gap between them.
import type { MoveId, Turn } from "@build-north/agents";
import { ObserveInteractiveMarker } from "expo-observe";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, View, type ScrollViewInstance } from "react-native";
import Animated from "react-native-reanimated";
import { AREA_LABEL, areaCopyOf } from "../area-copy.ts";
import { Composer } from "../components/composer.tsx";
import { ConceptMap } from "../components/concept-map.tsx";
import { GuessScreen } from "../components/guess.tsx";
import { Ask, Aside, ExampleIntro, ExampleSteps, FactCard, Failure, HintCard, LearnerMessage, Nudge, Revealed, useSlow, Waiting } from "../components/messages.tsx";
import { PartSheet } from "../components/part-sheet.tsx";
import { ResultScreen } from "../components/result.tsx";
import { SessionBar } from "../components/session-bar.tsx";
import { SiteHeader } from "../components/site-header.tsx";
import { Body, Button, KeyboardSafe, Screen, Sheet, Small, Title, useEntrance, usePageTitle, useWide } from "../components/ui.tsx";
import { WideStage } from "../components/work-stage.tsx";
import { WholeMapScreen } from "../components/whole-map.tsx";
import { tick } from "../haptics.ts";
import { comparisonAreasOf, firstExplanationOf } from "../session/comparison.ts";
import {
  cappedOf,
  currentPartOf,
  exampleParts,
  exampleStepsOf,
  eyebrowOf,
  guidedHelpOf,
  helpOf,
  isFollowUpFeedback,
  isReveal,
  justLitOf,
  lastPartNoteOf,
  leadOf,
  partClosingsOf,
  partNotesOf,
  partsOf,
  provedOf,
  resultMessagesOf,
  revealedPartsOf,
  revealHoldOf,
  waitingLineOf,
  withMapQuestions,
} from "../session/present.ts";
import { useSession } from "../session/session-context.tsx";
import { unsentOf, type Entry, type SessionState } from "../session/transcript.ts";
import { brand, firefly as FIREFLY, pageMetadata, size, space } from "../theme.ts";

const TITLE = `${brand.name}: build the concept's map yourself`;

/** The web page's title and card: a session opened or shared by its address, before the app sends it home. */
export function generateMetadata() {
  return pageMetadata(TITLE, "Your guess, the AI's questions, the help that costs a point, and the gap between how sure you felt and what you proved.");
}

export default function SessionScreen() {
  usePageTitle(TITLE);
  const router = useRouter();
  const { state, send, retry, start, edit, type } = useSession();
  const [again, setAgain] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const { turn } = state;
  // The result shows first (decided Oct 22); its Turn expects continue, and the app asks for the coach's words
  // at once, with no button, once per Turn. A failed ask shows Try again where the words go.
  const coachDue = turn?.phase === "result" && turn.expects === "continue" && turn.result?.coach === null;
  // keyed by session as well as Turn: the screen stays mounted across Try again, and the next session can end
  // on the same turn number (demo mode always does)
  const askedCoach = useRef<string | null>(null);
  useEffect(() => {
    if (!turn || !coachDue || state.pending || state.failure) return;
    const key = `${turn.sessionId}/${turn.turn}`;
    if (askedCoach.current === key) return;
    askedCoach.current = key;
    send({ action: "continue" });
  }, [turn, coachDue, state.pending, state.failure, send]);
  if (!turn) return <Redirect href="/" />;

  // back to the Start underneath: replacing this screen with "/" would stack a second Start on it (B14), and a
  // phone's back button would then open that stale one
  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  // the same concept with the same notes; a self-test is tried again as a self-test
  const tryAgain = async () => {
    const concept = turn.mentefacto.concept;
    setAgain({ busy: true, error: null });
    const problem = await start({ concept, ...(state.material ? { material: state.material } : {}), ...(state.mode === "test" ? { mode: state.mode } : {}) });
    setAgain({ busy: false, error: problem });
  };

  let screen: ReactNode;
  if (turn.phase === "predict") {
    screen = <GuessScreen turn={turn} pending={state.pending !== null} failure={state.failure} onLock={(prediction) => send({ prediction })} onClose={close} />;
  } else if (turn.phase === "result" && turn.result) {
    screen = (
      <ResultScreen
        concept={turn.mentefacto.concept}
        result={turn.result}
        map={turn.mentefacto}
        firstExplanation={firstExplanationOf(state.entries)}
        comparisonAreas={comparisonAreasOf(turn.mentefacto, state.entries)}
        notes={partNotesOf(resultMessagesOf(state.entries))}
        lastPart={lastPartNoteOf(state.entries)}
        closings={partClosingsOf(state.entries)}
        revealed={revealedPartsOf(state.entries, turn.result, state.mode)}
        conversation={state.entries}
        coachFailure={coachDue && state.failure ? state.failure.message : null}
        coachSources={turn.messages.find((message) => message.kind === "summary")?.sources}
        onRetryCoach={retry}
        onAgain={() => void tryAgain()}
        againBusy={again.busy}
        againError={again.error}
        onDone={close}
        onAnother={() => router.dismissTo("/")}
      />
    );
  } else if (turn.expects === "map") {
    screen = <WholeMapScreen turn={turn} state={state} send={send} retry={retry} edit={edit} onClose={close} />;
  } else {
    screen = <WorkScreen turn={turn} state={state} send={send} retry={retry} onType={type} onClose={close} />;
  }
  return (
    <>
      {screen}
      {/* the session is interactive as soon as it draws: its Turn is already here (Expo Observe's time to interactive) */}
      <ObserveInteractiveMarker />
    </>
  );
}

type WorkProps = { turn: Turn; state: SessionState; send: ReturnType<typeof useSession>["send"]; retry: () => void; onType: ReturnType<typeof useSession>["type"]; onClose: () => void };

function WorkScreen({ turn, state, send, retry, onType, onClose }: WorkProps) {
  const wide = useWide();
  const scroll = useRef<ScrollViewInstance>(null);
  const [passed, setPassed] = useState<string | null>(null);
  const [place, setPlace] = useState({ map: 0, ask: 0 });
  const slow = useSlow(state.pending !== null);
  // the guess has its own screen; earlier parts are on the map
  const all = state.entries.filter((e) => e.from !== "app" || e.phase !== "predict");
  const hold = revealHoldOf(all);
  const held = hold !== null && hold.key !== passed;
  const entries = held ? hold.entries : currentPartOf(all);
  // The worked example is offered, not imposed (decided Oct 22): a "See an example" button opens the walkthrough
  // and the planet map. Continue moves on either way, so the session's steps and scores don't change.
  const [exampleOpen, setExampleOpen] = useState(false);
  const offered = turn.phase === "example" && !!turn.example && !exampleOpen;
  const shown = offered ? entries.filter((e) => !(e.from === "app" && e.phase === "example")) : entries;
  const example = turn.phase === "example" && turn.example && exampleOpen ? turn.example : null;
  const baseParts = example ? exampleParts(example) : partsOf(turn, all, { held });
  // The first explanation stays unprompted; opening the example or starting the guided moves adds orientation.
  const parts = example ? withMapQuestions(baseParts, example, true) : turn.phase === "move" ? withMapQuestions(baseParts, turn.mentefacto) : baseParts;
  // a lit or revealed area opens to be read again, with what closed it (Cynthia, Oct 24); the worked example's map
  // has nothing of the learner's to open
  const [openPart, setOpenPart] = useState<MoveId | null>(null);
  const [hintAt, setHintAt] = useState<number | null>(null);
  const closings = partClosingsOf(all);
  const partSheet = <PartSheet view={openPart && !example ? (parts.find((p) => p.move === openPart) ?? null) : null} closing={openPart ? (closings[openPart] ?? null) : null} onClose={() => setOpenPart(null)} />;
  const onPartOpen = example ? undefined : setOpenPart;
  const lit = held ? null : justLitOf(turn);
  const pending = state.pending !== null;

  useEffect(() => {
    if (lit) tick();
  }, [lit, turn.turn]);

  const { failure } = state;
  const saved = failure && "text" in failure.body ? " Your answer is saved." : "";
  const help = helpOf(entries);
  const hint = guidedHelpOf(entries);
  const answerUncertain = failure?.retryable === true && "text" in failure.body;
  const requestHelp = () => { if (!answerUncertain && !pending && !held && turn.phase === "move") setHintAt(turn.turn); };
  const hintSheet = (
    <Sheet open={!answerUncertain && hintAt === turn.turn && !pending && !held && turn.phase === "move"} onClose={() => setHintAt(null)} label="guided help">
      <Title>{`Help for ${turn.move ? AREA_LABEL[turn.move] : "this area"}`}</Title>
      <Body>{hint.detail}</Body>
      <Button label={hint.confirm} onPress={() => {
        if (hintAt !== turn.turn || pending || held) return;
        setHintAt(null);
        send({ action: "help" });
      }} />
      <Button kind="text" label="Keep working" onPress={() => setHintAt(null)} />
    </Sheet>
  );
  const askedNow = !held && turn.phase === "move" && parts.some((p) => p.state === "asked");
  const placeholder = help.more ? "Your answer" : turn.phase === "move" && cappedOf(entries) ? "Try again, in your own words" : "In your own words";
  const concept = example ? example.concept : turn.mentefacto.concept;

  const conversation = (show: Show) => (
    <Conversation
      show={show}
      entries={shown}
      turn={turn}
      held={held}
      pending={pending}
      help={help}
      fireflyAfter={wide}
      onHelp={answerUncertain ? undefined : requestHelp}
      onAskLayout={(y) => setPlace((p) => (p.ask === y ? p : { ...p, ask: y }))}
    />
  );
  const status = (
    <>
      {offered && (
        <View style={styles.offer}>
          <Small dim>Your first explanation is saved. It is not scored.</Small>
          <Button kind="secondary" label="See an example" onPress={() => setExampleOpen(true)} />
        </View>
      )}
      {pending && <Waiting line={waitingLineOf(state.pending)} slow={slow} />}
      {failure && <Failure message={`${failure.message}${saved}`}>{failure.retryable && <Button kind="secondary" label="Try again" onPress={retry} />}</Failure>}
    </>
  );
  const composer = (
    <Composer
      turn={turn}
      pending={pending}
      placeholder={placeholder}
      help={hint}
      onHelp={requestHelp}
      onNext={held && hold ? () => setPassed(hold.key) : null}
      onSend={send}
      unsent={unsentOf(state)}
      onType={(move, text, edited) => onType(turn.sessionId, move, text, edited)}
      failed={failure !== null}
      retryableFailure={failure !== null && failure.retryable && "text" in failure.body}
      restore={failure && "text" in failure.body ? failure.body : null}
      flush={wide}
    />
  );
  // the worked example opens at its start; everything else follows the newest line
  const follow = () => (example ? scroll.current?.scrollTo({ y: 0, animated: true }) : scroll.current?.scrollToEnd({ animated: true }));
  const light = provedOf(turn, all);

  if (wide) {
    return (
      <Screen light={light}>
        <SiteHeader concept={turn.mentefacto.concept} end={<Button kind="secondary" solid label="Save and close" onPress={onClose} />} />
        <WideStage
          asked={askedNow ? (parts.find((p) => p.state === "asked")?.move ?? null) : null}
          fireflySize={help.more ? FIREFLY.states.helps.size : FIREFLY.states.asks.size}
          askY={place.ask}
          question={conversation("question")}
          thread={
            <ScrollView ref={scroll} style={styles.flex} contentContainerStyle={styles.thread} onContentSizeChange={follow} keyboardShouldPersistTaps="handled">
              {conversation("thread")}
              {status}
            </ScrollView>
          }
          composer={composer}
          map={(onGeometry) => <ConceptMap concept={concept} parts={parts} justLit={lit} pulse={turn.turn} onPartOpen={onPartOpen} onGeometry={onGeometry} />}
        />
        {partSheet}
        {hintSheet}
      </Screen>
    );
  }

  return (
    <Screen light={light}>
      <SessionBar concept={turn.mentefacto.concept} onClose={onClose} />
      <KeyboardSafe>
        <ScrollView ref={scroll} style={styles.flex} contentContainerStyle={styles.content} onContentSizeChange={follow} keyboardShouldPersistTaps="handled">
          {/* the firefly's line starts below the map: its height (a size, which the web reports on every change, unlike
              a position) plus the gap, plus where the question sits in the conversation */}
          <View onLayout={(e) => setPlace((p) => (p.map === e.nativeEvent.layout.height ? p : { ...p, map: e.nativeEvent.layout.height }))}>
            <ConceptMap
              concept={concept}
              parts={parts}
              justLit={lit}
              pulse={turn.turn}
              leaderFrom={askedNow ? { x: size.iconButton / 2, y: place.map + CONVERSATION_GAP + place.ask + 2 } : null}
              onPartOpen={onPartOpen}
            />
          </View>
          <View style={styles.conversation}>
            {conversation("all")}
            {status}
          </View>
        </ScrollView>
        {composer}
      </KeyboardSafe>
      {partSheet}
      {hintSheet}
    </Screen>
  );
}

/** Which lines a Conversation draws: all of them (the phone), or, in the website layout, the pinned question with
 * the lead over it (the feedback on the part just finished), and the thread under it. */
type Show = "all" | "question" | "thread";

type ConversationProps = {
  show: Show;
  entries: Entry[];
  turn: Turn;
  held: boolean;
  pending: boolean;
  help: ReturnType<typeof helpOf>;
  fireflyAfter: boolean;
  onHelp?: () => void;
  onAskLayout: (y: number) => void;
};

/** The part on screen: the lead that came with the question (the evaluator's words on the part just finished, set
 * quietly above it), the firefly's question, then the answers, nudges, hints, a revealed answer, facts and the
 * firefly's follow-up questions after it. The last part's name isn't repeated: the map shows how that part ended,
 * as the board does. Each line rises in once, when it arrives. */
function Conversation({ show, entries, turn, held, pending, help, fireflyAfter, onHelp, onAskLayout }: ConversationProps) {
  const entrance = useEntrance();
  const asked = entries.findIndex((e) => e.from === "app" && e.message.kind === "question");
  const lead = leadOf(entries);
  // the cap note goes with the first retry's nudge or the first hint of the part, once
  const capAt = entries.findIndex(
    (e, i) => i > asked && e.from === "app" && ((e.message.kind === "feedback" && !isFollowUpFeedback(entries, i)) || (e.message.kind === "hint" && e.message.hintStep !== "reveal")),
  );
  const active = !held && turn.phase === "move";
  // the worked example's lines show as four steps, drawn where its first line is
  const thinking = entries.flatMap((e) => (e.from === "app" && e.message.kind === "example" && e.message.agent !== "app" ? [e] : []));
  const steps = exampleStepsOf(thinking.map((e) => e.message.text));

  const line = (entry: Entry, i: number): ReactNode => {
    if (entry.from === "map") return null;
    if (entry.from === "learner") return <LearnerMessage text={entry.text} />;
    const { message } = entry;
    if (message.kind === "question") {
      const { eyebrow, text } = eyebrowOf(message.text);
      // the part's first question carries Help, the firefly; a follow-up is the firefly asking again
      if (i !== asked) return <Ask text={text} eyebrow={eyebrow} firefly={{ state: "asks", tag: null }} fireflyAfter={fireflyAfter} />;
      // Help is the firefly during a part; while an answer is checked it says so
      const firefly = pending
        ? { state: "asks" as const, tag: "checking", busy: true }
        : !active
          ? { state: "asks" as const, tag: null }
          : help.more
            ? { state: "helps" as const, tag: null }
            : { state: "asks" as const, tag: help.tag, label: help.label, onPress: onHelp };
      return (
        <>
          <Ask text={text} eyebrow={eyebrow} firefly={firefly} fireflyAfter={fireflyAfter} />
          {active && turn.scaffold && <Aside text={`Already on your map: ${turn.scaffold.given.join(", ")}. ${turn.scaffold.blanks} more for you to find.`} verbatim />}
        </>
      );
    }
    // before the question: the feedback on the part just finished, dim; its name and a revealed answer (read while
    // held) don't repeat
    if (asked >= 0 && i < asked) return lead.includes(entry) ? <Aside text={message.text} /> : null;
    switch (message.kind) {
      case "feedback":
        return <Nudge text={message.text} capNote={i === capAt} tag={isFollowUpFeedback(entries, i) ? "almost" : undefined} />;
      case "hint":
        return isReveal(entry) ? <Revealed text={message.text} /> : <HintCard message={message} capNote={i === capAt} concept={turn.mentefacto.concept} />;
      case "example":
        if (message.agent === "app") return <ExampleIntro text={message.text} />;
        if (!steps) return <Body>{areaCopyOf(message.text)}</Body>;
        return entry.id === thinking[0]?.id ? <ExampleSteps steps={steps} /> : null;
      case "fact":
      case "redirect":
        return <FactCard kind={message.kind} text={message.text} />;
      default:
        return <Aside text={message.text} />;
    }
  };

  return (
    <>
      {entries.map((entry, i) => {
        const isQuestion = i === asked;
        // in the website layout the lead is pinned with the question, over it
        const pinned = isQuestion || (asked >= 0 && i < asked);
        if ((show === "question" && !pinned) || (show === "thread" && pinned)) return null;
        const drawn = line(entry, i);
        return drawn ? (
          // the question's place in the conversation is where the phone's firefly line starts
          <Animated.View key={entry.id} style={entrance()} onLayout={isQuestion ? (e) => onAskLayout(e.nativeEvent.layout.y) : undefined}>
            {drawn}
          </Animated.View>
        ) : null;
      })}
    </>
  );
}

/** The map sits this far below the session bar, and the conversation this far below the map (the board). */
const MAP_TOP = 26;
const CONVERSATION_GAP = 32;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  offer: { alignItems: "flex-start" },
  content: { paddingHorizontal: space.margin, paddingTop: MAP_TOP, paddingBottom: space.xl },
  conversation: { marginTop: CONVERSATION_GAP, gap: space.l },
  thread: { gap: space.l, paddingBottom: space.l },
});
