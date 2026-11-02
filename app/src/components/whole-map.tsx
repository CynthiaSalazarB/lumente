// The learner writes answers on the map; the optional fact desk answers factual questions.
// Firefly's navigation cue highlights the next empty area without giving conceptual help or changing scores.
import { MOVE_ORDER, type Item, type Mentefacto, type MoveId, type Turn } from "@build-north/agents";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, TextInput, View, type ScrollViewInstance } from "react-native";
import Animated from "react-native-reanimated";
import { AREA_LABEL, areaCopyOf } from "../area-copy.ts";
import { categoryContextOf, chatKeyOf, deskOf, filledOf, hintNumberOf, hintPartOf, itemsOf, mapQuestionOf, nextPartOf, partMeaningOf, partTextOf, waitingLineOf, wholeMapHelpOf, wholeMapPartsOf, withPart } from "../session/present.ts";
import type { LearnerInput } from "../session/session-context.tsx";
import type { SessionState } from "../session/transcript.ts";
import { maxContentWidth, motion, parts as PARTS, radius, size, space, type } from "../theme.ts";
import { ConceptMap, type MapGeometry } from "./concept-map.tsx";
import { Firefly } from "./firefly.tsx";
import { FactCard, Failure, HintCard, LearnerMessage, Revealed, useSlow, Waiting } from "./messages.tsx";
import { SessionBar } from "./session-bar.tsx";
import { SiteHeader } from "./site-header.tsx";
import { WideStage } from "./work-stage.tsx";
import { Body, Button, IconButton, KeyboardSafe, Label, MicButton, PromptField, Reply, Screen, SendButton, Sheet, Small, Title, useEntrance, useColors, useInertPage, useWide, VoiceNote } from "./ui.tsx";
import { useVoice } from "./use-voice.ts";

const MAX_ITEMS = 6;
type Props = {
  turn: Turn;
  state: SessionState;
  send: (input: LearnerInput) => void;
  retry: () => void;
  edit: (draft: Mentefacto) => void;
  onClose: () => void;
};

export function WholeMapScreen({ turn, state, send, retry, edit, onClose }: Props) {
  const wide = useWide();
  const entrance = useEntrance();
  const scroll = useRef<ScrollViewInstance>(null);
  const [editing, setEditing] = useState<MoveId | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [mapHeight, setMapHeight] = useState(0);
  const pending = state.pending !== null;
  const slow = useSlow(pending);
  const map = state.draft ?? turn.mentefacto;
  const concept = turn.mentefacto.concept;
  const filled = filledOf(map);
  const next = nextPartOf(map);
  const submitting = state.pending !== null && "mentefacto" in state.pending;
  const help = wholeMapHelpOf(turn.progress.hintsUsed);
  const hintMove = hintPartOf(turn.progress.hintsUsed);
  const desk = deskOf(state.entries);
  const hints = desk.filter((e) => e.from === "app" && e.message.kind === "hint").map((e) => e.id);
  const asked = desk.filter((e) => e.from === "learner").length;
  const { failure } = state;
  const saved = failure && "mentefacto" in failure.body ? " Your map is saved." : "";
  const openPart = (move: MoveId) => { if (!pending) setEditing(move); };
  // On the phone the chat's thread sits under the map, the guide and the status, past the first screen, and the
  // ask bar is pinned below: a reply landed out of view with nothing to say it had. Each new line in the chat
  // (and a call in flight, and a failure) scrolls into view once, as the website layout's column already does.
  const followed = useRef("");
  const follow = () => {
    const key = chatKeyOf(desk, pending, failure !== null);
    if (!chatOpen || key === followed.current) return;
    followed.current = key;
    scroll.current?.scrollToEnd({ animated: true });
  };

  const conceptMap = (onGeometry?: (geometry: MapGeometry) => void, leader = false) => (
    <ConceptMap
      concept={concept}
      parts={wholeMapPartsOf(map, turn.mentefacto)}
      activePart={next}
      onPartPress={openPart}
      onGeometry={onGeometry}
      leaderFrom={leader && next ? { x: size.iconButton / 2, y: mapHeight + space.l + 20 } : null}
    />
  );
  const status = (
    <View style={styles.status}>
      <View style={styles.statusText} accessibilityLiveRegion="polite">
        <Small>{`${filled} of 4 areas filled`}</Small>
        <Small dim>Scored together when you submit.</Small>
        {filled === 0 && <Small dim>Write in an area to review your map.</Small>}
      </View>
      <Button kind={filled === 4 ? "primary" : "secondary"} fit={wide} label="Review & submit" busy={submitting} disabled={pending || filled === 0} hint="Review your answers before submitting your map for scoring." onPress={() => setConfirming(true)} />
    </View>
  );
  const intro = (
    <>
      <Label dim>{state.mode === "test" ? "Test myself" : "Independent practice"}</Label>
      <Title>Build your map</Title>
      {/* the whole task in one line, for someone who has never seen the screen (Cynthia, Oct 24) */}
      <Small dim>{"Fill the four areas, then submit."}</Small>
    </>
  );
  const guide = (
    <View style={styles.guideGroup}>
      <View style={[styles.you, wide && styles.reverse]}>
        <View style={styles.firefly}><Firefly state="asks" /></View>
        <View style={styles.guideText} accessibilityLiveRegion="polite">
          {next && <Label dim>{`Area ${MOVE_ORDER.indexOf(next) + 1} of 4`}</Label>}
          <Reply>{next ? mapQuestionOf(next, concept) : "Ready to review your map"}</Reply>
        </View>
      </View>
      {next && <Button label={filled === 0 ? "Start writing" : "Write my answer"} hint={mapQuestionOf(next, concept)} fit={wide} disabled={pending} onPress={() => openPart(next)} />}
      <Small dim>{"You can edit any area. Following the highlight doesn't use a hint."}</Small>
    </View>
  );
  const thread = (
    <>
      {chatOpen && desk.map((entry) => {
        let line: ReactNode = null;
        if (entry.from === "learner") line = <LearnerMessage text={entry.text} asking />;
        else if (entry.from === "app") {
          const { message } = entry;
          if (message.kind === "fact" || message.kind === "redirect") line = <FactCard kind={message.kind} text={message.text} />;
          else if (message.kind === "hint") {
            // Count from the Turn's total so a resumed session still names the correct area.
            const n = hintNumberOf(turn.progress.hintsUsed, hints.length, hints.indexOf(entry.id));
            line = message.hintStep === "reveal"
              ? <View style={styles.guideText}><Label dim>{`${AREA_LABEL[hintPartOf(n)]} · 0 points`}</Label><Revealed text={message.text} /></View>
              : <HintCard message={message} capNote={n % 4 === 0} part={PARTS[hintPartOf(n)].label} concept={concept} />;
          } else line = <Body>{areaCopyOf(message.text)}</Body>;
        }
        return line ? <Animated.View key={entry.id} style={entrance()}>{line}</Animated.View> : null;
      })}
      {pending && <Waiting line={waitingLineOf(state.pending)} slow={slow} />}
      {failure && <Failure message={`${failure.message}${saved}`}>{failure.retryable && <Button kind="secondary" label="Try again" onPress={retry} />}</Failure>}
    </>
  );
  const deskControls = (
    <View style={[styles.deskControls, !wide && styles.bar]}>
      <Button kind={chatOpen ? "text" : "secondary"} label={chatOpen ? "Close fact chat" : "Ask a fact (optional)"} onPress={() => setChatOpen((open) => !open)} style={chatOpen ? styles.start : undefined} />
      <View style={[styles.chat, !chatOpen && styles.hidden]}>
        <Small dim>Asking costs nothing. Answers go on the map.</Small>
        <AskBar concept={concept} pending={pending} asking={state.pending !== null && "question" in state.pending} onAsk={(question) => send({ question })} />
      </View>
      {help && (
        <View style={styles.hintControl}>
          <Button kind="hintLink" label={help.tag === "help −1" ? "Get a hint · −1 point" : "More help"} disabled={pending} onPress={() => setHintOpen(true)} style={styles.start} />
          <Small dim>{`For ${AREA_LABEL[hintMove]}. See the scoring effect before you confirm.`}</Small>
        </View>
      )}
    </View>
  );
  const sheets = (
    <>
      {editing && (
        <PartEditor
          key={editing}
          move={editing}
          concept={concept}
          category={categoryContextOf(map)}
          items={itemsOf(map, editing)}
          onDraft={(items) => edit(withPart(map, editing, items))}
          onDone={(items) => {
            edit(withPart(map, editing, items));
            setEditing(null);
          }}
        />
      )}
      <HintSheet
        open={hintOpen}
        move={hintMove}
        hintsUsed={turn.progress.hintsUsed}
        onClose={() => setHintOpen(false)}
        onConfirm={() => {
          setHintOpen(false);
          setChatOpen(true);
          send({ action: "help" });
        }}
      />
      <SubmitSheet open={confirming} map={map} onClose={() => setConfirming(false)} onSubmit={() => {
        setConfirming(false);
        send({ mentefacto: { ...map, concept } });
      }} />
    </>
  );

  if (wide) {
    return (
      <Screen>
        <SiteHeader concept={concept} end={<><Asked n={asked} /><Button kind="secondary" solid label="Save and close" onPress={onClose} /></>} />
        <WideStage
          asked={next}
          fireflySize={40}
          intro={intro}
          question={guide}
          thread={<View style={styles.thread}>{thread}</View>}
          composer={deskControls}
          scrollWords
          followWords={chatOpen}
          mapHeader={<Label dim>Your answers</Label>}
          map={(onGeometry) => conceptMap(onGeometry)}
          mapFooter={status}
        />
        {sheets}
      </Screen>
    );
  }

  return (
    <Screen>
      <SessionBar concept={concept} onClose={onClose} end={<Asked n={asked} />} />
      <KeyboardSafe>
        <ScrollView ref={scroll} style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" onContentSizeChange={follow}>
          <View style={styles.intro}>{intro}</View>
          <View onLayout={(e) => setMapHeight(e.nativeEvent.layout.height)}>
            {conceptMap(undefined, true)}
          </View>
          {guide}
          {status}
          {thread}
        </ScrollView>
        {deskControls}
      </KeyboardSafe>
      {sheets}
    </Screen>
  );
}

/** One small amber square per question asked, in the top bar. */
function Asked({ n }: { n: number }) {
  const c = useColors();
  if (n === 0) return null;
  const shown = Math.min(n, 6);
  return (
    <View style={styles.asked} role="img" accessibilityLabel={`${n} ${n === 1 ? "question" : "questions"} asked`}>
      {Array.from({ length: shown }, (_, i) => (
        <View key={i} style={[styles.square, { backgroundColor: c.firefly }]} />
      ))}
      {n > shown && <Label style={{ color: c.question }}>{`+${n - shown}`}</Label>}
    </View>
  );
}

/** Optional fact question input. A spoken question still needs the learner to press Ask. */
function AskBar({ concept, pending, asking, onAsk }: { concept: string; pending: boolean; asking: boolean; onAsk: (question: string) => void }) {
  const [text, setText] = useState("");
  const question = text.trim();
  const voice = useVoice({ text, onText: setText });
  const submit = () => {
    if (!question || pending) return;
    // what is on screen is what goes; a phrase still being heard stops here instead of landing in the emptied field
    if (voice.state.kind === "listening") voice.cancel();
    onAsk(question);
    setText("");
  };
  return (
    <View>
      <View style={styles.askRow}>
        <MicButton state={voice.state} onPress={voice.toggle} disabled={pending && voice.state.kind !== "listening"} />
        <PromptField
          value={text}
          onChangeText={(typed) => {
            // the learner's edit stands: listening stops instead of rebuilding the field over it
            voice.cancel();
            setText(typed);
          }}
          placeholder={voice.state.kind === "listening" ? "Listening" : "Ask a factual question"}
          multiline
          maxLength={500}
          editable={!pending}
          accessibilityLabel={`Your question about ${concept}`}
          onSubmitEditing={submit}
          submitBehavior="submit"
          style={[styles.flex, pending && styles.dim]}
          end={<SendButton busy={asking} disabled={!question || pending} onPress={submit} label="Ask a fact" />}
        />
      </View>
      <VoiceNote state={voice.state} />
    </View>
  );
}

/** One part of the map, in a sheet (a dialog in the website layout): the bigger group is one field; the other
 * parts are lists, and each thing it isn't carries how it differs. Closing it keeps what was typed. */
function PartEditor({ move, concept, category, items, onDraft, onDone }: { move: MoveId; concept: string; category: string | null; items: Item[]; onDraft: (items: Item[]) => void; onDone: (items: Item[]) => void }) {
  const c = useColors();
  const wide = useWide();
  const entrance = useEntrance();
  const single = move === "supraordinate";
  const nextRow = useRef(Math.max(items.length, 1));
  const blank = () => ({ id: nextRow.current++, value: "", note: null });
  const [rows, setRows] = useState<(Item & { id: number })[]>(() => (items.length > 0 ? items : [{ value: "", note: null }]).map((row, id) => ({ ...row, id })));
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRows = useRef(rows);
  const onDraftRef = useRef(onDraft);
  useEffect(() => {
    onDraftRef.current = onDraft;
  }, [onDraft]);
  const valuesOf = (source: (Item & { id: number })[]) => source.map(({ value, note }) => ({ value, note }));
  useEffect(() => () => {
    if (draftTimer.current === null) return;
    clearTimeout(draftTimer.current);
    draftTimer.current = null;
    onDraftRef.current(latestRows.current.map(({ value, note }) => ({ value, note })));
  }, []);
  const publish = (next: (Item & { id: number })[]) => {
    latestRows.current = next;
    setRows(next);
    if (draftTimer.current !== null) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      draftTimer.current = null;
      onDraftRef.current(valuesOf(next));
    }, 400);
  };
  const change = (i: number, patch: Partial<Item>) => publish(latestRows.current.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const done = () => {
    if (draftTimer.current !== null) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    onDone(valuesOf(latestRows.current));
  };
  // the mic in the head dictates into the field last focused (the first item until one is)
  const [focus, setFocus] = useState<{ i: number; part: "value" | "note" }>({ i: 0, part: "value" });
  const voice = useVoice({
    text: rows[focus.i]?.[focus.part] ?? "",
    onText: (text) => change(focus.i, focus.part === "value" ? { value: text } : { note: text }),
  });
  const remove = (i: number) => {
    voice.cancel();
    const current = latestRows.current;
    const empty = blank();
    publish(current.length > 1 ? current.filter((_, j) => j !== i) : [empty]);
    setFocus((now) => ({ ...now, i: i < now.i ? now.i - 1 : Math.min(now.i, Math.max(0, current.length - 2)) }));
  };
  const add = () => {
    const row = blank();
    publish([...latestRows.current, row]);
  };
  // no custom line height on these fields: on Android a multiline one would show only its last line
  const field = [styles.input, { fontFamily: type.input.fontFamily, fontSize: type.input.fontSize, color: c.onSurface, backgroundColor: c.surface, borderColor: c.fieldEdge }];
  const scrim = <Pressable style={[wide ? StyleSheet.absoluteFill : styles.flex, { backgroundColor: c.scrim }]} onPress={done} accessibilityRole="button" accessibilityLabel="Save and close" />;
  // mounted only while open, like a Sheet's open state: the map under it is inert on the web
  useInertPage(true);

  // the scrim fades in with the Modal and the editor rises into place over 240 ms, as a Sheet does; on the web the Modal
  // is the dialog, named after its area as a Sheet is after its label
  return (
    <Modal visible transparent animationType="fade" onRequestClose={done} accessibilityLabel={AREA_LABEL[move]}>
      <KeyboardAvoidingView style={[styles.flex, wide && styles.center]} behavior="padding">
        {scrim}
        <Animated.View style={[wide ? styles.dialog : styles.sheet, { backgroundColor: c.surfaceContainer, borderColor: c.fieldEdge }, entrance(0, "rise", motion.sheet)]} accessibilityViewIsModal>
          {!wide && <View style={[styles.grabber, { backgroundColor: c.outline }]} />}
          <View style={styles.sheetHead}>
            <View style={[styles.flex, styles.sheetTitle, !wide && styles.fullTitle]}>
              <Label dim>{`Area ${MOVE_ORDER.indexOf(move) + 1} of 4`}</Label>
              <Title style={styles.title}>{mapQuestionOf(move, concept)}</Title>
              <Small dim>{partMeaningOf(move, concept)}</Small>
              {(move === "exclusion" || move === "isoordinate") && category && <Small>{category}</Small>}
            </View>
            <MicButton state={voice.state} onPress={voice.toggle} />
            <Button kind="secondary" label="Save answer" onPress={done} />
          </View>
          <VoiceNote state={voice.state} />
          <ScrollView contentContainerStyle={styles.rows} keyboardShouldPersistTaps="handled">
            {rows.map((row, i) => (
              <View key={row.id} style={styles.row}>
                <View style={styles.rowFields}>
                  <Small dim>{single ? "Category" : move === "exclusion" ? "Another concept in this category" : move === "isoordinate" ? `Defining feature ${i + 1}` : i === 0 ? "Your grouping rule and types" : `Additional type ${i + 1}, using the same rule`}</Small>
                  <TextInput
                    value={row.value}
                    onChangeText={(value) => {
                      voice.cancel();
                      change(i, { value });
                    }}
                    placeholder={move === "infraordinate" && i > 0 ? "Another type using your grouping rule" : PLACEHOLDER[move]}
                    placeholderTextColor={c.placeholder}
                    maxLength={move === "infraordinate" ? 500 : 120}
                    multiline={move === "infraordinate"}
                    autoFocus={i === 0 && row.value === ""}
                    accessibilityLabel={single ? "Category" : move === "exclusion" ? `Comparison concept ${i + 1}` : move === "isoordinate" ? `Defining feature ${i + 1}` : i === 0 ? "Your grouping rule and types" : `Additional type ${i + 1}`}
                    style={field}
                    returnKeyType="done"
                    onSubmitEditing={done}
                    onFocus={() => setFocus({ i, part: "value" })}
                  />
                  {move === "exclusion" && (
                    <>
                      <Small dim>What distinguishes it?</Small>
                      <TextInput
                        value={row.note ?? ""}
                        onChangeText={(note) => {
                          voice.cancel();
                          change(i, { note });
                        }}
                        placeholder="The key difference from this concept"
                        placeholderTextColor={c.placeholder}
                        maxLength={200}
                        multiline
                        accessibilityLabel={`Key difference ${i + 1}`}
                        style={[field, styles.note]}
                        onFocus={() => setFocus({ i, part: "note" })}
                      />
                    </>
                  )}
                </View>
                {!single && (rows.length > 1 || row.value !== "") && <IconButton icon="x" label={`Remove item ${i + 1}`} onPress={() => remove(i)} />}
              </View>
            ))}
            {!single && rows.length < MAX_ITEMS && (
              <Button kind="text" label="+ Add another" onPress={add} style={styles.start} />
            )}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const PLACEHOLDER: Record<MoveId, string> = {
  supraordinate: "The closest category",
  exclusion: "Another concept from this category",
  isoordinate: "A defining feature",
  infraordinate: "Grouping rule: …; types: …",
};

/** The confirmation names the actual hint target; it never follows the navigation highlight. */
function HintSheet({ open, move, hintsUsed, onClose, onConfirm }: { open: boolean; move: MoveId; hintsUsed: number; onClose: () => void; onConfirm: () => void }) {
  const reveal = hintsUsed % 4 === 3;
  const first = hintsUsed % 4 === 0;
  return (
    <Sheet open={open} onClose={onClose} label="hint">
      <Title style={styles.title}>{`${reveal ? "Reveal" : "Hint for"} ${AREA_LABEL[move]}?`}</Title>
      <Body>{reveal ? "This shows the answer. This area will score 0 points." : first ? "This hint limits this area to 1 point instead of 2." : "This area is already limited to 1 point. This hint doesn't reduce it further."}</Body>
      <Small dim>{"Hints follow the map's area order, even if you are editing another area."}</Small>
      <Button label={reveal ? "Reveal answer · 0 points" : "Get hint"} onPress={onConfirm} />
      <Button kind="text" label="Keep working" onPress={onClose} />
    </Sheet>
  );
}

/** Review before a final submit, with a clear warning for empty areas. */
function SubmitSheet({ open, map, onClose, onSubmit }: { open: boolean; map: Mentefacto; onClose: () => void; onSubmit: () => void }) {
  const empty = MOVE_ORDER.filter((move) => partTextOf(map, move) === null).map((move) => AREA_LABEL[move]);
  return (
    <Sheet open={open} onClose={onClose} label="map review">
      <Title style={styles.title}>Review your map</Title>
      <ScrollView style={styles.review} contentContainerStyle={styles.reviewRows}>
        {MOVE_ORDER.map((move) => (
          <View key={move} style={styles.reviewRow}>
            <Small>{AREA_LABEL[move]}</Small>
            <Small dim>{itemsOf(map, move).map((item) => item.value + (item.note ? ` — ${item.note}` : "")).join("; ") || "Left empty"}</Small>
          </View>
        ))}
      </ScrollView>
      {empty.length > 0 && <Small dim>{`${empty.join(", ")}: still empty. Empty areas score 0.`}</Small>}
      <Body>Submitting ends the session.</Body>
      <Button label="Submit my map" onPress={onSubmit} />
      <Button kind="text" label="Keep editing" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: space.margin, paddingTop: space.l, paddingBottom: space.l, gap: space.l },
  intro: { gap: space.s },
  guideGroup: { gap: space.m },
  guideText: { flex: 1, gap: space.xs },
  status: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.m },
  statusText: { gap: space.xs },
  you: { flexDirection: "row", alignItems: "flex-start", gap: space.m },
  reverse: { flexDirection: "row-reverse" },
  firefly: { width: size.iconButton, alignItems: "center" },
  asked: { flexDirection: "row", alignItems: "center", gap: space.xs },
  square: { width: 8, height: 8, borderRadius: radius.point },
  bar: { paddingHorizontal: space.margin, paddingBottom: space.m },
  deskControls: { gap: space.s, paddingBottom: space.l },
  chat: { gap: space.s },
  hidden: { display: "none" },
  hintControl: { gap: space.xs },
  askRow: { flexDirection: "row", alignItems: "flex-end", gap: space.s },
  dim: { opacity: 0.55 },
  sheet: {
    borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderWidth: 1, borderBottomWidth: 0,
    paddingHorizontal: space.margin, paddingTop: space.m, paddingBottom: space.xxl, gap: space.l,
    width: "100%", maxWidth: maxContentWidth, maxHeight: "85%", alignSelf: "center",
  },
  center: { alignItems: "center", justifyContent: "center", padding: space.xl },
  dialog: { borderRadius: radius.sheet, borderWidth: 1, padding: space.xxl, gap: space.l, width: "100%", maxWidth: 560, maxHeight: "90%" },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2 },
  sheetHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: space.m },
  sheetTitle: { gap: space.xs, flexShrink: 1 },
  fullTitle: { flexBasis: "100%" },
  title: { fontSize: 24, lineHeight: 30 },
  rows: { gap: space.m, paddingBottom: space.s },
  row: { flexDirection: "row", alignItems: "flex-start", gap: space.s },
  rowFields: { flex: 1, gap: space.s },
  input: { minHeight: size.button, paddingHorizontal: space.l, paddingVertical: space.m, borderRadius: radius.field, borderWidth: 1 },
  note: { maxHeight: 112, textAlignVertical: "top" },
  start: { alignSelf: "flex-start", paddingHorizontal: 0 },
  thread: { gap: space.l, paddingVertical: space.s },
  review: { maxHeight: 260, flexShrink: 1 },
  reviewRows: { gap: space.l },
  reviewRow: { gap: space.xs },
});
