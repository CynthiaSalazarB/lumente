import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { AtkinsonHyperlegibleMono_400Regular, AtkinsonHyperlegibleMono_600SemiBold } from "@expo-google-fonts/atkinson-hyperlegible-mono";
import { AtkinsonHyperlegibleNext_400Regular, AtkinsonHyperlegibleNext_600SemiBold } from "@expo-google-fonts/atkinson-hyperlegible-next";
import { Newsreader_400Regular, Newsreader_400Regular_Italic, Newsreader_500Medium } from "@expo-google-fonts/newsreader";
import { FontDisplay } from "expo-font";
import { Observe, ObserveRoot } from "expo-observe";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Failure } from "../components/messages.tsx";
import { Button, Screen, Small, Title, useColors } from "../components/ui.tsx";
import { useBrandFonts } from "../components/use-brand-fonts.ts";
import type { SessionClient } from "../session/client.ts";
import { clerkKey, createClient } from "../session/config.ts";
import { SessionProvider } from "../session/session-context.tsx";
import { base, brand, space } from "../theme.ts";

// The splash stays up until the fonts and Clerk are ready, so the first frame is already in its own fonts.
void SplashScreen.preventAutoHideAsync();

// Without a Clerk key, everyone counts as signed in and API calls carry the dev headers (local dev).
const devClient = createClient();

/** Clerk's sign-in (on the web) names the app and skips its "Welcome back! Please sign in to continue". */
const localization = {
  signIn: {
    start: {
      title: `Sign in to ${brand.name}`,
      titleCombined: `Sign in to ${brand.name}`,
      subtitle: "Use Google or get a one-time code by email. No password needed.",
      subtitleCombined: "Use Google or get a one-time code by email. No password needed.",
    },
    emailCode: { subtitle: "Check your inbox, then enter the code here." },
  },
  signUp: {
    start: {
      title: `Join ${brand.name}`,
      titleCombined: `Join ${brand.name}`,
      subtitle: "Create your account with Google or a one-time code by email.",
      subtitleCombined: "Create your account with Google or a one-time code by email.",
    },
    emailCode: { subtitle: "Enter the one-time code we sent to your email." },
  },
};

// Expo Observe records launch times and crashes on phone release builds (it does nothing on the web)
export default ObserveRoot.wrap(RootLayout);

// The window behind every screen is the near-black the light grows out of, so nothing white shows between
// screens or around the keyboard on Android (the web's root HTML sets its own).
if (Platform.OS !== "web") void SystemUI.setBackgroundColorAsync(base.bottom).catch(() => undefined);

/** A crash in a screen shows this instead of a red screen, with a way to try again. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  // Expo Router's boundary catches the crash before Observe's global handler sees it, so it is reported here:
  // a learner who taps Try again still leaves a trace in the release's error list
  useEffect(() => {
    Observe.reportError(error);
  }, [error]);
  return (
    <SafeAreaProvider>
      <Screen>
        <View style={styles.error}>
          <Title>Something broke on our side.</Title>
          <Failure message={`Try again. If it keeps happening, ${Platform.OS === "web" ? "reload the page" : "restart the app"}.`}>
            <Button kind="secondary" label="Try again" onPress={() => void retry()} />
          </Failure>
        </View>
      </Screen>
    </SafeAreaProvider>
  );
}

const BRAND_FONTS = {
  Newsreader_400Regular: { uri: Newsreader_400Regular, display: FontDisplay.SWAP },
  Newsreader_400Regular_Italic: { uri: Newsreader_400Regular_Italic, display: FontDisplay.SWAP },
  Newsreader_500Medium: { uri: Newsreader_500Medium, display: FontDisplay.SWAP },
  AtkinsonHyperlegibleNext_400Regular: { uri: AtkinsonHyperlegibleNext_400Regular, display: FontDisplay.SWAP },
  AtkinsonHyperlegibleNext_600SemiBold: { uri: AtkinsonHyperlegibleNext_600SemiBold, display: FontDisplay.SWAP },
  AtkinsonHyperlegibleMono_400Regular: { uri: AtkinsonHyperlegibleMono_400Regular, display: FontDisplay.SWAP },
  AtkinsonHyperlegibleMono_600SemiBold: { uri: AtkinsonHyperlegibleMono_600SemiBold, display: FontDisplay.SWAP },
};

function RootLayout() {
  const [loaded, failed] = useBrandFonts(BRAND_FONTS);
  // a font that fails to load falls back to the system's rather than blocking the app
  if (!loaded && !failed) return <Loading />;
  return (
    <SafeAreaProvider>
      {clerkKey ? (
        // the web's two forms link to each other on this site, and both end on Start; a phone ignores these
        <ClerkProvider publishableKey={clerkKey} tokenCache={tokenCache} localization={localization} signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/">
          <ClerkApp />
        </ClerkProvider>
      ) : (
        <App client={devClient} signedIn clerk={false} />
      )}
    </SafeAreaProvider>
  );
}

// #22: every API call carries the Clerk session token, and a signed-out learner only sees sign-in.
function ClerkApp() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const client = useMemo(() => createClient(() => getToken()), [getToken]);
  // no screen until Clerk knows whether someone is signed in
  if (!isLoaded) return <Loading />;
  // Expiry and account switching can bypass our Sign out button; no previous learner's UI survives an identity change.
  return <App key={userId ?? "signed-out"} client={client} signedIn={!!isSignedIn} clerk />;
}

/** Until the fonts register and Clerk loads. On the web this is the exported page, so it shows before the bundle
 * and Clerk's script arrive (seconds on a phone network); a phone shows its splash over it. */
function Loading() {
  const c = useColors();
  return (
    <View style={styles.loading} accessibilityRole="status" accessibilityLiveRegion="polite">
      <ActivityIndicator color={c.onSurface} />
      <Small dim>Loading {brand.name}…</Small>
    </View>
  );
}

function App({ client, signedIn, clerk }: { client: SessionClient; signedIn: boolean; clerk: boolean }) {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);
  return (
    <SessionProvider client={client}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: base.bottom } }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="index" />
          <Stack.Screen name="concepts" />
          {/* a session rises from the start screen */}
          <Stack.Screen name="session" options={{ animation: "slide_from_bottom" }} />
        </Stack.Protected>
        <Stack.Protected guard={clerk && !signedIn}>
          <Stack.Screen name="sign-in" options={{ animation: "fade" }} />
          <Stack.Screen name="sign-up" options={{ animation: "fade" }} />
        </Stack.Protected>
      </Stack>
    </SessionProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.m },
  error: { flex: 1, justifyContent: "center", gap: space.xl, paddingHorizontal: space.margin, width: "100%", maxWidth: 560, alignSelf: "center" },
});
