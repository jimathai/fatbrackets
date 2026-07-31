"use client";

import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { supabase } from "./lib/supabase";
import "./styles/globals.css";
import "./styles/auth.css";
import "./styles/product.css";

const sizes = [4, 8, 16, 32, 64];
const premiumSize = 128;
const colors = ["#ed4d4d", "#7c3aed", "#2563eb", "#0891b2", "#0f766e", "#ea580c", "#db2777", "#ca8a04"];
const primaryTags = ["Music", "Movies & TV", "Sports", "Food", "Games", "People", "Anything Goes", "Undefined"];
const nextMatchupModeKey = "fatbrackets:next-matchup-mode";
const lastBracketKey = "fatbrackets:last-open-bracket";

type View = "dashboard" | "explore" | "builder" | "manage" | "bracket" | "admin";
type SaveState = "idle" | "saving" | "saved" | "error";
type Tournament = {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  bracket_size: number;
  status: "draft" | "published" | "completed";
  visibility: "private" | "unlisted" | "public";
  tags: string[];
  voting_enabled: boolean;
  updated_at: string;
  cloned_from_id?: string | null;
  cloned_from_name?: string | null;
};
type Contestant = {
  id?: string;
  seed: number;
  name: string;
  shortName: string;
  details: string;
  imageUrl: string;
  accentColor: string;
  locked?: boolean;
  overallSeed?: number;
};
type ImportedEntry = {
  name: string;
  seed?: number;
  description?: string;
  imageUrl?: string;
};
type WinnerMap = Record<string, string>;
type PlayMode = "manual" | "voting" | "random";
type SeedingStyle = "regional" | "overall";
type EntryMethod = "manual" | "paste" | "upload";

type AppSettings = {
  frictionStrength: number;
  momentumSensitivity: number;
  defaultZoom: number;
  minimumZoom: number;
  maximumZoom: number;
  matchupHoverScale: number;
  doubleTapZoomPercent: number;
  canvasBackgroundColor: string;
  canvasPattern: "grid" | "dots" | "crosshatch" | "none";
  canvasTint: number;
};

const defaultAppSettings: AppSettings = {
  frictionStrength: 140,
  momentumSensitivity: 1,
  defaultZoom: 0.82,
  minimumZoom: 0.22,
  maximumZoom: 1.35,
  matchupHoverScale: 1.06,
  doubleTapZoomPercent: 35,
  canvasBackgroundColor: "#0a1428",
  canvasPattern: "grid",
  canvasTint: 0,
};

function loadAppSettings(): AppSettings {
  if (typeof window === "undefined") return defaultAppSettings;
  try {
    const stored = window.localStorage.getItem("fatbrackets:admin-settings");
    return stored ? { ...defaultAppSettings, ...JSON.parse(stored) } : defaultAppSettings;
  } catch {
    return defaultAppSettings;
  }
}

function blankContestants(size: number): Contestant[] {
  return Array.from({ length: size }, (_, index) => ({
    seed: index + 1,
    name: "",
    shortName: "",
    details: "",
    imageUrl: "",
    accentColor: colors[index % colors.length],
    overallSeed: index + 1,
  }));
}

function defaultRegionNames(size: number) {
  if (size < 32) return [];
  const count = size / 16;
  if (count === 2) return ["North", "South"];
  if (count === 4) return ["North", "South", "East", "West"];
  if (count === 8) return ["North", "South", "East", "West", "Northeast", "Northwest", "Southeast", "Southwest"];
  return Array.from({ length: count }, (_, index) => `Region ${index + 1}`);
}

function regionCountForSize(size: number) {
  return size >= 32 ? size / 16 : 1;
}

function regionalSeedForSlot(slotSeed: number) {
  return ((slotSeed - 1) % 16) + 1;
}

function overallSeedForSlot(slotSeed: number, size: number) {
  const regionCount = regionCountForSize(size);
  if (regionCount === 1) return slotSeed;
  const regionIndex = Math.floor((slotSeed - 1) / 16);
  const regionalSeed = regionalSeedForSlot(slotSeed);
  const position = regionalSeed % 2 === 1 ? regionIndex : regionCount - 1 - regionIndex;
  return (regionalSeed - 1) * regionCount + position + 1;
}

function slotForOverallSeed(overallSeed: number, size: number) {
  const regionCount = regionCountForSize(size);
  if (regionCount === 1) return overallSeed;
  const regionalSeed = Math.ceil(overallSeed / regionCount);
  const position = (overallSeed - 1) % regionCount;
  const regionIndex = regionalSeed % 2 === 1 ? position : regionCount - 1 - position;
  return regionIndex * 16 + regionalSeed;
}

function displayedSeed(contestant: Contestant, size: number, style: SeedingStyle) {
  return style === "regional" && size >= 32
    ? regionalSeedForSlot(contestant.seed)
    : contestant.overallSeed ?? overallSeedForSlot(contestant.seed, size);
}

function seedOrder(size: number) {
  let order = [1, 2];
  for (let current = 4; current <= size; current *= 2) {
    order = order.flatMap((seed) => [seed, current + 1 - seed]);
  }
  return order;
}

function firstRoundSlotOrder(size: number) {
  if (size < 32) return seedOrder(size);
  const regionCount = size / 16;
  const regionalOrder = seedOrder(16);
  return Array.from({ length: regionCount }, (_, regionIndex) =>
    regionalOrder.map((regionalSeed) => regionIndex * 16 + regionalSeed),
  ).flat();
}

function initials(name: string) {
  if (!name.trim()) return "+";
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function matchKey(round: number, match: number) {
  return `${round}-${match}`;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [loading, setLoading] = useState(true);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [publicBrackets, setPublicBrackets] = useState<Tournament[]>([]);
  const [tournamentId, setTournamentId] = useState<string | null>(null);
  const [activeTournament, setActiveTournament] = useState<Tournament | null>(null);
  const [tournamentName, setTournamentName] = useState("");
  const [size, setSize] = useState(16);
  const [contestants, setContestants] = useState<Contestant[]>(blankContestants(16));
  const [playMode, setPlayMode] = useState<PlayMode>("manual");
  const [tags, setTags] = useState<string[]>(["Undefined"]);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [seedingStyle, setSeedingStyle] = useState<SeedingStyle>("regional");
  const [regionNames, setRegionNames] = useState<string[]>(defaultRegionNames(16));
  const [winners, setWinners] = useState<WinnerMap>({});
  const [selectedSeed, setSelectedSeed] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [search, setSearch] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authMessage, setAuthMessage] = useState("");
  const [appSettings, setAppSettings] = useState<AppSettings>(loadAppSettings);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) setTournaments([]);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) loadDashboard();
  }, [session]);

  async function loadDashboard() {
    setLoading(true);
    const { data } = await supabase
      .from("tournaments")
      .select("id,owner_id,name,slug,bracket_size,status,visibility,tags,voting_enabled,updated_at,cloned_from_id,cloned_from_name")
      .eq("owner_id", session?.user.id ?? "")
      .order("updated_at", { ascending: false });
    setTournaments((data ?? []) as Tournament[]);
    setLoading(false);
  }

  async function loadExplore() {
    setLoading(true);
    const { data } = await supabase
      .from("tournaments")
      .select("id,owner_id,name,slug,bracket_size,status,visibility,tags,voting_enabled,updated_at,cloned_from_id,cloned_from_name")
      .eq("visibility", "public")
      .in("status", ["published", "completed"])
      .order("updated_at", { ascending: false })
      .limit(12);
    setPublicBrackets((data ?? []) as Tournament[]);
    setLoading(false);
  }

  function newTournament() {
    setTournamentId(null);
    setActiveTournament(null);
    setTournamentName("");
    setSize(16);
    setContestants(blankContestants(16));
    setPlayMode("manual");
    setTags(["Undefined"]);
    setVisibility("private");
    setSeedingStyle("regional");
    setRegionNames(defaultRegionNames(16));
    setWinners({});
    setSelectedSeed(null);
    setSaveState("idle");
    setView("builder");
  }

  async function openTournament(tournament: Tournament, targetView: "manage" | "bracket" = "manage") {
    const previousBracketId = window.localStorage.getItem(lastBracketKey);
    if (previousBracketId && previousBracketId !== tournament.id) {
      window.localStorage.setItem(nextMatchupModeKey, "false");
    }
    window.localStorage.setItem(lastBracketKey, tournament.id);
    setLoading(true);
    const [{ data: contestantRows }, { data: matchRows }] = await Promise.all([
      supabase.from("contestants").select("*").eq("tournament_id", tournament.id).order("seed"),
      supabase.from("matches").select("round_number,match_number,winner_id").eq("tournament_id", tournament.id),
    ]);
    const slots = blankContestants(tournament.bracket_size);
    (contestantRows ?? []).forEach((row) => {
      slots[row.seed - 1] = {
        id: row.id,
        seed: row.seed,
        name: row.name,
        shortName: row.short_name ?? "",
        details: row.details ?? "",
        imageUrl: row.image_url ?? "",
        accentColor: row.accent_color ?? colors[(row.seed - 1) % colors.length],
        overallSeed: row.seed,
      };
    });
    const loadedWinners: WinnerMap = {};
    (matchRows ?? []).forEach((row) => {
      if (row.winner_id) loadedWinners[matchKey(row.round_number, row.match_number - 1)] = row.winner_id;
    });
    setTournamentId(tournament.id);
    setActiveTournament(tournament);
    setTournamentName(tournament.name);
    setSize(tournament.bracket_size);
    setPlayMode(tournament.voting_enabled ? "voting" : "manual");
    setTags(tournament.tags?.length ? tournament.tags : ["Undefined"]);
    setVisibility(tournament.visibility === "public" ? "public" : "private");
    const storedRegions = window.localStorage.getItem(`fatbrackets:regions:${tournament.id}`);
    try {
      setRegionNames(storedRegions ? JSON.parse(storedRegions) : defaultRegionNames(tournament.bracket_size));
    } catch {
      setRegionNames(defaultRegionNames(tournament.bracket_size));
    }
    const storedSeedingStyle = window.localStorage.getItem(`fatbrackets:seeding-style:${tournament.id}`) as SeedingStyle | null;
    const nextSeedingStyle: SeedingStyle = storedSeedingStyle === "overall" ? "overall" : "regional";
    setSeedingStyle(nextSeedingStyle);
    const storedOverallSeeds = window.localStorage.getItem(`fatbrackets:overall-seeds:${tournament.id}`);
    try {
      const overallSeeds: number[] = storedOverallSeeds ? JSON.parse(storedOverallSeeds) : [];
      slots.forEach((item, index) => {
        item.overallSeed = overallSeeds[index] || overallSeedForSlot(item.seed, tournament.bracket_size);
      });
    } catch {
      slots.forEach((item) => { item.overallSeed = overallSeedForSlot(item.seed, tournament.bracket_size); });
    }
    const storedLocks = window.localStorage.getItem(`fatbrackets:locks:${tournament.id}`);
    try {
      const lockedSeeds = new Set<number>(storedLocks ? JSON.parse(storedLocks) : []);
      slots.forEach((item) => { item.locked = lockedSeeds.has(item.seed); });
    } catch {
      // Ignore malformed local lock preferences.
    }
    setContestants(slots);
    setWinners(loadedWinners);
    setSelectedSeed(null);
    setSaveState("saved");
    const canManage = Boolean(session && tournament.owner_id === session.user.id);
    setView(targetView === "manage" && !canManage ? "bracket" : targetView);
    setLoading(false);
  }

  async function openOriginalBracket(originalId: string) {
    const { data, error } = await supabase
      .from("tournaments")
      .select("id,owner_id,name,slug,bracket_size,status,visibility,tags,voting_enabled,updated_at,cloned_from_id,cloned_from_name")
      .eq("id", originalId)
      .single();
    if (error || !data) {
      window.alert("The original bracket is no longer available.");
      return;
    }
    await openTournament(data as Tournament, "bracket");
  }

  async function cloneTournament(source: Tournament) {
    if (!session) {
      setAuthOpen(true);
      return;
    }
    setLoading(true);
    const { data: sourceContestants, error: contestantError } = await supabase
      .from("contestants")
      .select("seed,name,short_name,details,image_url,accent_color")
      .eq("tournament_id", source.id)
      .order("seed");
    if (contestantError) {
      setLoading(false);
      window.alert(`Could not clone bracket: ${contestantError.message}`);
      return;
    }
    const clonedTags = Array.from(new Set([...(source.tags ?? ["Undefined"]), "Cloned"]));
    const cloneName = `${source.name} (Clone)`;
    const slug = `${source.slug || source.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-clone-${crypto.randomUUID().slice(0, 8)}`;
    const { data: cloned, error: cloneError } = await supabase
      .from("tournaments")
      .insert({
        owner_id: session.user.id,
        name: cloneName.slice(0, 80),
        slug,
        bracket_size: source.bracket_size,
        tags: clonedTags,
        visibility: "private",
        status: "draft",
        voting_enabled: source.voting_enabled,
        cloned_from_id: source.id,
        cloned_from_name: source.name,
      })
      .select("id,owner_id,name,slug,bracket_size,status,visibility,tags,voting_enabled,updated_at,cloned_from_id,cloned_from_name")
      .single();
    if (cloneError || !cloned) {
      setLoading(false);
      window.alert(`Could not clone bracket: ${cloneError?.message ?? "Unknown error"}`);
      return;
    }
    if (sourceContestants?.length) {
      const { error: copyError } = await supabase.from("contestants").insert(sourceContestants.map((item) => ({
        tournament_id: cloned.id,
        seed: item.seed,
        name: item.name,
        short_name: item.short_name,
        details: item.details,
        image_url: item.image_url,
        accent_color: item.accent_color,
      })));
      if (copyError) {
        await supabase.from("tournaments").delete().eq("id", cloned.id);
        setLoading(false);
        window.alert(`Could not copy contestants: ${copyError.message}`);
        return;
      }
    }
    setLoading(false);
    await loadDashboard();
    await openTournament(cloned as Tournament, "manage");
  }

  async function deleteTournament(id: string) {
    if (!session || activeTournament?.owner_id !== session.user.id) {
      window.alert("Only the bracket owner can delete this bracket.");
      return;
    }
    if (!window.confirm("Delete this bracket permanently? This cannot be undone.")) return;
    const { error } = await supabase.from("tournaments").delete().eq("id", id).eq("owner_id", session.user.id);
    if (error) {
      window.alert(`Could not delete bracket: ${error.message}`);
      return;
    }
    setTournaments((current) => current.filter((item) => item.id !== id));
    setTournamentId(null);
    setView("dashboard");
    await loadDashboard();
  }

  async function clearBracket() {
    if (!session || activeTournament?.owner_id !== session.user.id) {
      window.alert("Only the bracket owner can clear this bracket.");
      return;
    }
    if (!window.confirm("Clear every selected winner and reset this bracket? Contestants and seeds will stay in place.")) return;
    setWinners({});
    if (!tournamentId) {
      setSaveState("idle");
      return;
    }
    setSaveState("saving");
    const { error } = await supabase.from("matches").delete().eq("tournament_id", tournamentId);
    setSaveState(error ? "error" : "saved");
    if (error) window.alert(`Could not clear bracket: ${error.message}`);
  }

  function changeSize(nextSize: number) {
    setSize(nextSize);
    setContestants((current) =>
      blankContestants(nextSize).map((slot, index) => current[index] ? { ...current[index], seed: index + 1, overallSeed: current[index].overallSeed ?? index + 1 } : slot),
    );
    setRegionNames((current) => {
      const defaults = defaultRegionNames(nextSize);
      return defaults.map((name, index) => current[index] || name);
    });
    setWinners({});
    setSaveState("idle");
  }

  function updateContestant(seed: number, patch: Partial<Contestant>) {
    setContestants((current) => current.map((item) => item.seed === seed ? { ...item, ...patch } : item));
    setSaveState("idle");
  }

  function randomize() {
    const shuffled = [...contestants].sort(() => Math.random() - 0.5);
    setContestants(shuffled.map((item, index) => ({ ...item, seed: index + 1 })));
    setWinners({});
    setSaveState("idle");
  }

  function invalidatePlayedBracket() {
    if (!Object.keys(winners).length) return true;
    const approved = window.confirm("Changing seeds or regions will reset the current matchup results. Continue?");
    if (approved) setWinners({});
    return approved;
  }

  function swapContestants(fromSeed: number, toSeed: number) {
    if (fromSeed === toSeed || !invalidatePlayedBracket()) return;
    setContestants((current) => {
      const from = current[fromSeed - 1];
      const to = current[toSeed - 1];
      if (!from || !to) return current;
      const content = (item: Contestant) => ({
        name: item.name,
        shortName: item.shortName,
        details: item.details,
        imageUrl: item.imageUrl,
        accentColor: item.accentColor,
        locked: item.locked,
        overallSeed: item.overallSeed,
      });
      const next = [...current];
      next[fromSeed - 1] = {
        ...from,
        ...content(to),
        seed: fromSeed,
        overallSeed: size < 32 ? fromSeed : to.overallSeed,
      };
      next[toSeed - 1] = {
        ...to,
        ...content(from),
        seed: toSeed,
        overallSeed: size < 32 ? toSeed : from.overallSeed,
      };
      return next;
    });
    setSaveState("idle");
  }

  function toggleLock(seed: number) {
    setContestants((current) => current.map((item) => item.seed === seed ? { ...item, locked: !item.locked } : item));
  }

  function randomizeRange(startSeed = 1, endSeed = size) {
    if (!invalidatePlayedBracket()) return;
    setContestants((current) => {
      const next = [...current];
      const indexes = next
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.seed >= startSeed && item.seed <= endSeed && !item.locked)
        .map(({ index }) => index);
      const values = indexes.map((index) => ({
        name: next[index].name,
        shortName: next[index].shortName,
        details: next[index].details,
        imageUrl: next[index].imageUrl,
        accentColor: next[index].accentColor,
        locked: next[index].locked,
      }));
      for (let index = values.length - 1; index > 0; index--) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [values[index], values[randomIndex]] = [values[randomIndex], values[index]];
      }
      indexes.forEach((slotIndex, index) => { next[slotIndex] = { ...next[slotIndex], ...values[index], overallSeed: overallSeedForSlot(next[slotIndex].seed, size) }; });
      return next;
    });
    setSaveState("idle");
  }

  function changeSeedingStyle(nextStyle: SeedingStyle) {
    if (nextStyle === seedingStyle) return;
    if (!invalidatePlayedBracket()) return;
    if (nextStyle === "overall" && size >= 32) {
      setContestants((current) => {
        const ranked = [...current].sort((a, b) => (a.overallSeed ?? a.seed) - (b.overallSeed ?? b.seed));
        const next = blankContestants(size);
        ranked.forEach((item, index) => {
          const overallSeed = index + 1;
          const slotSeed = slotForOverallSeed(overallSeed, size);
          next[slotSeed - 1] = { ...item, seed: slotSeed, overallSeed };
        });
        return next;
      });
    } else {
      setContestants((current) => current.map((item) => ({ ...item, overallSeed: item.overallSeed ?? overallSeedForSlot(item.seed, size) })));
    }
    setSeedingStyle(nextStyle);
    setSaveState("idle");
  }

  async function uploadContestantImage(seed: number, file: File) {
    if (!session) { setAuthOpen(true); return; }
    let activeId = tournamentId;
    if (!activeId) activeId = await saveTournament();
    if (!activeId) return;
    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const safeExtension = ["jpg", "jpeg", "png", "webp", "gif"].includes(extension) ? extension : "jpg";
    const path = `${session.user.id}/${activeId}/${crypto.randomUUID()}.${safeExtension}`;
    setSaveState("saving");
    const { error } = await supabase.storage.from("contestant-images").upload(path, file, { cacheControl: "3600", upsert: false });
    if (error) { setSaveState("error"); return; }
    const { data } = supabase.storage.from("contestant-images").getPublicUrl(path);
    updateContestant(seed, { imageUrl: data.publicUrl });
    setSaveState("idle");
  }

  async function saveTournament(): Promise<string | null> {
    if (!session) {
      setAuthOpen(true);
      return null;
    }
    if (!tournamentName.trim()) return null;
    setSaveState("saving");
    let activeId = tournamentId;
    if (activeId) {
      if (activeTournament?.owner_id !== session.user.id) {
        return failSave("Only the bracket owner can edit this bracket.");
      }
      const { error } = await supabase
        .from("tournaments")
        .update({ name: tournamentName.trim(), bracket_size: size, tags, visibility, status: visibility === "public" ? "published" : "draft", voting_enabled: playMode === "voting", updated_at: new Date().toISOString() })
        .eq("id", activeId)
        .eq("owner_id", session.user.id);
      if (error) return failSave();
    } else {
      const slug = `${tournamentName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "tournament"}-${crypto.randomUUID().slice(0, 8)}`;
      const { data, error } = await supabase
        .from("tournaments")
        .insert({ owner_id: session.user.id, name: tournamentName.trim(), slug, bracket_size: size, tags, visibility, status: visibility === "public" ? "published" : "draft", voting_enabled: playMode === "voting" })
        .select("id,owner_id,name,slug,bracket_size,status,visibility,tags,voting_enabled,updated_at,cloned_from_id,cloned_from_name")
        .single();
      if (error || !data) return failSave();
      activeId = data.id;
      setTournamentId(activeId);
      setActiveTournament(data as Tournament);
    }

    if (activeId && size >= 32) {
      window.localStorage.setItem(`fatbrackets:regions:${activeId}`, JSON.stringify(regionNames));
    }
    if (activeId) {
      window.localStorage.setItem(`fatbrackets:locks:${activeId}`, JSON.stringify(contestants.filter((item) => item.locked).map((item) => item.seed)));
      window.localStorage.setItem(`fatbrackets:seeding-style:${activeId}`, seedingStyle);
      window.localStorage.setItem(`fatbrackets:overall-seeds:${activeId}`, JSON.stringify(contestants.map((item) => item.overallSeed ?? overallSeedForSlot(item.seed, size))));
    }

    const removedIds = contestants.filter((item) => item.id && !item.name.trim()).map((item) => item.id as string);
    if (removedIds.length) {
      const { error } = await supabase.from("contestants").delete().in("id", removedIds);
      if (error) return failSave(error.message);
    }

    const filled = contestants.filter((item) => item.name.trim());
    if (filled.length) {
      // Existing contestants may have traded seed slots after a drag, randomize,
      // region move, or seeding-style change. Move those rows to unique temporary
      // seeds first so the database's (tournament_id, seed) constraint does not
      // reject an otherwise valid swap.
      const existing = filled.filter((item) => item.id);
      const temporaryResults = await Promise.all(existing.map((item, index) =>
        supabase
          .from("contestants")
          .update({ seed: size + index + 1, updated_at: new Date().toISOString() })
          .eq("id", item.id as string),
      ));
      const temporaryError = temporaryResults.find((result) => result.error)?.error;
      if (temporaryError) return failSave(temporaryError.message);

      const { data, error } = await supabase
        .from("contestants")
        .upsert(filled.map((item) => ({
          ...(item.id ? { id: item.id } : {}),
          tournament_id: activeId,
          seed: item.seed,
          name: item.name.trim(),
          short_name: item.shortName.trim() || item.name.trim(),
          details: item.details.trim(),
          image_url: item.imageUrl.trim() || null,
          accent_color: item.accentColor,
          updated_at: new Date().toISOString(),
        })), { onConflict: "id" })
        .select();
      if (error) return failSave(error.message);
      const bySeed = new Map((data ?? []).map((row) => [row.seed, row]));
      setContestants((current) => current.map((item) => {
        const row = bySeed.get(item.seed);
        return row ? { ...item, id: row.id } : { ...item, id: item.name.trim() ? item.id : undefined };
      }));
    }

    setSaveState("saved");
    await loadDashboard();
    return activeId;
  }

  function failSave(message?: string) {
    console.error("FatBrackets save failed:", message || "Unknown save error");
    setSaveState("error");
    if (message) window.alert(`Could not save changes: ${message}`);
    return null;
  }

  async function openBracket() {
    const id = await saveTournament();
    if (!id) return;
    const previousBracketId = window.localStorage.getItem(lastBracketKey);
    if (previousBracketId && previousBracketId !== id) {
      window.localStorage.setItem(nextMatchupModeKey, "false");
    }
    window.localStorage.setItem(lastBracketKey, id);
    if (contestants.some((item) => !item.name.trim())) {
      setSaveState("error");
      return;
    }
    setSelectedSeed(null);
    setView("bracket");
  }

  const contestantById = useMemo(
    () => new Map(contestants.filter((item) => item.id).map((item) => [item.id as string, item])),
    [contestants],
  );

  function roundParticipants(round: number, match: number): Array<Contestant | null> {
    if (round === 1) {
      const order = firstRoundSlotOrder(size);
      return [contestants[order[match * 2] - 1] ?? null, contestants[order[match * 2 + 1] - 1] ?? null];
    }
    return [0, 1].map((offset) => {
      const winnerId = winners[matchKey(round - 1, match * 2 + offset)];
      return winnerId ? contestantById.get(winnerId) ?? null : null;
    });
  }

  function selectWinner(round: number, match: number, contestant: Contestant) {
    if (!contestant.id) return;

    setWinners((current) => {
      const next: WinnerMap = {
        ...current,
        [matchKey(round, match)]: contestant.id as string,
      };
      const rounds = Math.log2(size);
      const order = firstRoundSlotOrder(size);

      // Revalidate the bracket from the first round forward. A later pick is
      // preserved when that contestant is still a valid participant in the
      // matchup; only selections made impossible by the changed result are removed.
      for (let currentRound = 1; currentRound <= rounds; currentRound++) {
        const matchCount = size / 2 ** currentRound;

        for (let currentMatch = 0; currentMatch < matchCount; currentMatch++) {
          let participantIds: Array<string | undefined>;

          if (currentRound === 1) {
            participantIds = [
              contestants[order[currentMatch * 2] - 1]?.id,
              contestants[order[currentMatch * 2 + 1] - 1]?.id,
            ];
          } else {
            participantIds = [
              next[matchKey(currentRound - 1, currentMatch * 2)],
              next[matchKey(currentRound - 1, currentMatch * 2 + 1)],
            ];
          }

          const key = matchKey(currentRound, currentMatch);
          const winnerId = next[key];
          if (winnerId && !participantIds.includes(winnerId)) delete next[key];
        }
      }

      return next;
    });
    setSaveState("idle");
  }

  async function saveBracket() {
    if (!tournamentId) return;
    if (!session || activeTournament?.owner_id !== session.user.id) {
      window.alert("Only the bracket owner can save matchup changes.");
      return;
    }
    if (size >= 32) window.localStorage.setItem(`fatbrackets:regions:${tournamentId}`, JSON.stringify(regionNames));
    setSaveState("saving");
    const rounds = Math.log2(size);
    const rows = [];
    for (let round = 1; round <= rounds; round++) {
      const matchCount = size / 2 ** round;
      for (let match = 0; match < matchCount; match++) {
        const [one, two] = roundParticipants(round, match);
        rows.push({
          tournament_id: tournamentId,
          round_number: round,
          match_number: match + 1,
          contestant_one_id: one?.id ?? null,
          contestant_two_id: two?.id ?? null,
          winner_id: winners[matchKey(round, match)] ?? null,
          updated_at: new Date().toISOString(),
        });
      }
    }
    const { error } = await supabase.from("matches").upsert(rows, { onConflict: "tournament_id,round_number,match_number" });
    setSaveState(error ? "error" : "saved");
  }

  function updateAppSettings(nextSettings: AppSettings) {
    setAppSettings(nextSettings);
    window.localStorage.setItem("fatbrackets:admin-settings", JSON.stringify(nextSettings));
  }

  const activeIsOwner = Boolean(session && activeTournament?.owner_id === session.user.id);

  async function authenticate() {
    setAuthMessage("");
    const result = authMode === "signup"
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) return setAuthMessage(result.error.message);
    if (authMode === "signup" && !result.data.session) return setAuthMessage("Check your email to confirm your account.");
    setAuthOpen(false);
  }

  return (
    <main>
      <AppHeader
        session={session}
        view={view}
        onDashboard={() => { setView("dashboard"); loadDashboard(); }}
        onExplore={() => { setView("explore"); loadExplore(); }}
        onAdmin={() => setView("admin")}
        onSignIn={() => setAuthOpen(true)}
      />

      {view === "dashboard" && (
        <Dashboard
          loading={loading}
          session={session}
          tournaments={tournaments}
          onNew={session ? newTournament : () => setAuthOpen(true)}
          onOpen={(item) => openTournament(item, "bracket")}
          onManage={(item) => openTournament(item, "manage")}
          onClone={cloneTournament}
          onOpenOriginal={openOriginalBracket}
        />
      )}

      {view === "explore" && (
        <Explore
          loading={loading}
          brackets={publicBrackets}
          onOpen={(item) => openTournament(item, "bracket")}
          onCreate={session ? newTournament : () => setAuthOpen(true)}
          onClone={cloneTournament}
          onOpenOriginal={openOriginalBracket}
          canClone={Boolean(session)}
        />
      )}

      {view === "builder" && (
        <Builder
          contestants={contestants}
          name={tournamentName}
          saveState={saveState}
          search={search}
          selectedSeed={selectedSeed}
          size={size}
          onBack={() => { setView("dashboard"); loadDashboard(); }}
          onBracket={openBracket}
          onChangeName={(value) => { setTournamentName(value); setSaveState("idle"); }}
          onChangeSize={changeSize}
          onRandomize={randomize}
          onImport={(entries) => {
            const nextSize = sizes.find((candidate) => candidate >= entries.length) ?? 64;
            setSize(nextSize);
            const ordered = [...entries].sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999));
            setContestants(blankContestants(nextSize).map((slot, index) => {
              const entry = ordered[index];
              return entry ? { ...slot, seed: entry.seed && entry.seed <= nextSize ? entry.seed : index + 1, name: entry.name, shortName: entry.name, details: entry.description ?? "", imageUrl: entry.imageUrl ?? "" } : slot;
            }).sort((a, b) => a.seed - b.seed));
            setRegionNames(defaultRegionNames(nextSize));
            setWinners({});
            setSelectedSeed(null);
            setSaveState("idle");
          }}
          playMode={playMode}
          tags={tags}
          visibility={visibility}
          regionNames={regionNames}
          onRegionNames={(names) => { setRegionNames(names); setSaveState("idle"); }}
          onPlayMode={(mode) => { setPlayMode(mode); setSaveState("idle"); }}
          onTags={(nextTags) => { setTags(nextTags); setSaveState("idle"); }}
          onVisibility={(nextVisibility) => { setVisibility(nextVisibility); setSaveState("idle"); }}
          onSave={saveTournament}
          onSearch={setSearch}
          onSelectSeed={setSelectedSeed}
          onUpdateContestant={updateContestant}
        />
      )}

      {view === "manage" && activeIsOwner && (
        <ManageBracket
          contestants={contestants}
          name={tournamentName}
          saveState={saveState}
          size={size}
          regionNames={regionNames}
          playMode={playMode}
          tags={tags}
          visibility={visibility}
          seedingStyle={seedingStyle}
          selectedSeed={selectedSeed}
          onBack={() => { setView("dashboard"); loadDashboard(); }}
          onOpenBracket={openBracket}
          onSave={saveTournament}
          onName={(value) => { setTournamentName(value); setSaveState("idle"); }}
          onRegionNames={(names) => { setRegionNames(names); setSaveState("idle"); }}
          onPlayMode={(mode) => { setPlayMode(mode); setSaveState("idle"); }}
          onTags={(nextTags) => { setTags(nextTags); setSaveState("idle"); }}
          onVisibility={(nextVisibility) => { setVisibility(nextVisibility); setSaveState("idle"); }}
          onSeedingStyle={changeSeedingStyle}
          onSelectSeed={setSelectedSeed}
          onUpdateContestant={updateContestant}
          onSwap={swapContestants}
          onToggleLock={toggleLock}
          onRandomizeAll={() => randomizeRange(1, size)}
          onRandomizeRegion={(regionIndex) => randomizeRange(regionIndex * 16 + 1, regionIndex * 16 + 16)}
          onUploadImage={uploadContestantImage}
          onMergeImport={(entries) => {
            setContestants((current) => mergeImportedEntries(current, entries));
            setWinners({});
            setSelectedSeed(null);
            setSaveState("idle");
          }}
          onDelete={() => tournamentId && deleteTournament(tournamentId)}
          clonedFromId={activeTournament?.cloned_from_id ?? null}
          clonedFromName={activeTournament?.cloned_from_name ?? null}
          onOpenOriginal={openOriginalBracket}
        />
      )}


      {view === "admin" && (
        <AdminSettings
          settings={appSettings}
          onChange={updateAppSettings}
          onReset={() => updateAppSettings(defaultAppSettings)}
        />
      )}

      {view === "bracket" && (
        <Bracket
          tournamentId={tournamentId}
          contestants={contestants}
          name={tournamentName}
          saveState={saveState}
          size={size}
          winners={winners}
          regionNames={regionNames}
          seedingStyle={seedingStyle}
          settings={appSettings}
          editable={activeIsOwner}
          participants={roundParticipants}
          onSave={saveBracket}
          onClear={clearBracket}
          onEdit={() => setView("manage")}
          onWinner={selectWinner}
        />
      )}

      {authOpen && (
        <AuthModal
          email={email}
          message={authMessage}
          mode={authMode}
          password={password}
          onAuth={authenticate}
          onClose={() => setAuthOpen(false)}
          onEmail={setEmail}
          onMode={() => setAuthMode(authMode === "login" ? "signup" : "login")}
          onPassword={setPassword}
        />
      )}
    </main>
  );
}

function AppHeader({ session, view, onDashboard, onExplore, onAdmin, onSignIn }: { session: Session | null; view: View; onDashboard: () => void; onExplore: () => void; onAdmin: () => void; onSignIn: () => void }) {
  return <header>
    <button className="brand brandButton" onClick={onDashboard}><i>///</i>Fat<span>Brackets</span></button>
    <nav><button className={view === "dashboard" ? "active" : ""} onClick={onDashboard}>My Brackets</button><button className={view === "explore" ? "active" : ""} onClick={onExplore}>Explore</button>{session && <button className={view === "admin" ? "active" : ""} onClick={onAdmin}>Admin</button>}</nav>
    {session
      ? <button className="profile" onClick={() => supabase.auth.signOut()}><span className="profileAvatar">{session.user.email?.slice(0, 1).toUpperCase() || "U"}</span> <b>Sign out</b></button>
      : <button className="profile" onClick={onSignIn}>FB <b>Sign in</b></button>}
  </header>;
}

function Dashboard({ loading, session, tournaments, onNew, onOpen, onManage, onClone, onOpenOriginal }: {
  loading: boolean; session: Session | null; tournaments: Tournament[]; onNew: () => void; onOpen: (item: Tournament) => void; onManage: (item: Tournament) => void; onClone: (item: Tournament) => void; onOpenOriginal: (id: string) => void;
}) {
  return <div className="workspace dashboard">
    <div className="dashboardHero">
      <div><small>YOUR BRACKET HQ</small><h1>Make the matchup.<br /><span>Settle the debate.</span></h1><p>Create a bracket for sports, music, movies—or whatever your group argues about most.</p></div>
      <button onClick={onNew}>＋ Create Bracket</button>
    </div>
    <div className="dashboardTop"><div><h2>My Brackets</h2><p>Pick up where you left off.</p></div><span>{tournaments.length} total</span></div>
    {!session ? <EmptyState title="Sign in to build your first bracket" text="Your brackets will stay synced across devices." button="Sign in" onClick={onNew} />
      : loading ? <div className="loadingState">Loading your brackets…</div>
      : tournaments.length === 0 ? <EmptyState title="No brackets yet" text="Create your first bracket and start seeding the field." button="Create Bracket" onClick={onNew} />
      : <div className="tournamentGrid">{tournaments.map((item) => <article className="tournamentCard" key={item.id}>
          <div className="cardBracket"><span /><span /><span /><span /></div>
          <div className="cardMeta"><span className={`statusPill ${item.status}`}>{item.status}</span><span>{item.bracket_size} contestants</span></div>
          <h3>{item.name}</h3>
          {item.cloned_from_id && <button className="cloneLineage" onClick={() => onOpenOriginal(item.cloned_from_id as string)}>Cloned from {item.cloned_from_name || "original bracket"} ↗</button>}
          <p>Updated {new Date(item.updated_at).toLocaleDateString()}</p>
          <button className="cloneTextButton" onClick={() => onClone(item)}>Clone bracket</button><div className="cardActions adminCardActions"><button className="manageButton" onClick={() => onManage(item)}>Manage</button><button onClick={() => onOpen(item)}>Open Bracket</button></div>
        </article>)}</div>}
  </div>;
}

function Explore({ loading, brackets, onOpen, onCreate, onClone, onOpenOriginal, canClone }: { loading: boolean; brackets: Tournament[]; onOpen: (item: Tournament) => void; onCreate: () => void; onClone: (item: Tournament) => void; onOpenOriginal: (id: string) => void; canClone: boolean }) {
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const categories = [
    { icon: "♫", title: "Music", text: "Songs, albums, artists and eras." },
    { icon: "▣", title: "Movies & TV", text: "Characters, episodes and all-time favorites." },
    { icon: "★", title: "Sports", text: "Players, teams, moments and debates." },
    { icon: "♨", title: "Food", text: "Dishes, restaurants, snacks and flavors." },
    { icon: "◆", title: "Games", text: "Video games, board games and characters." },
    { icon: "☻", title: "Anything Goes", text: "Places, ideas—or pure chaos." },
  ];
  const visible = activeTag ? brackets.filter((item) => item.tags?.includes(activeTag)) : brackets;
  return <div className="workspace explorePage">
    <section className="exploreHero"><div><small>DISCOVER THE DEBATE</small><h1>Explore brackets made for everything.</h1><p>Find a matchup worth arguing about, follow its winner, or use it as inspiration for your own.</p></div><button onClick={onCreate}>＋ Create Bracket</button></section>
    <section className="exploreSection"><div className="dashboardTop"><div><h2>Browse by tag</h2><p>Brackets can live in more than one lane.</p></div>{activeTag && <button className="clearTagFilter" onClick={() => setActiveTag(null)}>Show all</button>}</div><div className="categoryGrid">{categories.map((category) => <button className={`categoryCard ${activeTag === category.title ? "active" : ""}`} key={category.title} onClick={() => setActiveTag(category.title)}><i>{category.icon}</i><div><h3>{category.title}</h3><p>{category.text}</p></div></button>)}</div></section>
    <section className="exploreSection"><div className="dashboardTop"><div><h2>{activeTag ? `${activeTag} brackets` : "Public brackets"}</h2><p>Published brackets from the FatBrackets community.</p></div><span>{visible.length} available</span></div>
      {loading ? <div className="loadingState">Loading public brackets…</div>
        : visible.length === 0 ? <div className="exploreEmpty"><b>No brackets found here yet.</b><p>Create the first public bracket for this tag and claim the lane.</p><button onClick={onCreate}>Create the first contender</button></div>
        : <div className="tournamentGrid exploreGrid">{visible.map((item) => <article className="tournamentCard" key={item.id}><div className="cardBracket"><span /><span /><span /><span /></div><div className="cardMeta"><span className={`statusPill ${item.status}`}>{item.status}</span><span>{item.bracket_size} contestants</span></div><h3>{item.name}</h3>{item.cloned_from_id && <button className="cloneLineage" onClick={() => onOpenOriginal(item.cloned_from_id as string)}>Cloned from {item.cloned_from_name || "original bracket"} ↗</button>}<div className="tagRow">{(item.tags ?? []).slice(0,4).map((tag) => <span key={tag}>{tag}</span>)}</div><p>Updated {new Date(item.updated_at).toLocaleDateString()}</p><div className="cardActions exploreActions"><button onClick={() => onOpen(item)}>View Bracket</button><button onClick={() => onClone(item)}>{canClone ? "Clone" : "Sign in to clone"}</button></div></article>)}</div>}
    </section>
  </div>;
}

function TagSelector({ tags, onChange, compact = false }: { tags: string[]; onChange: (tags: string[]) => void; compact?: boolean }) {
  const [customTag, setCustomTag] = useState("");
  const primarySelected = tags.filter((tag) => primaryTags.includes(tag));
  const customTags = tags.filter((tag) => !primaryTags.includes(tag));
  function togglePrimary(tag: string) {
    let next = [...tags];
    if (tag === "Undefined") {
      next = next.includes("Undefined") ? next.filter((item) => item !== "Undefined") : [...next.filter((item) => !primaryTags.includes(item)), "Undefined"];
    } else if (next.includes(tag)) {
      next = next.filter((item) => item !== tag);
    } else {
      next = [...next.filter((item) => item !== "Undefined"), tag];
    }
    if (!next.some((item) => primaryTags.includes(item))) next = ["Undefined", ...next];
    onChange(Array.from(new Set(next)));
  }
  function addCustomTag() {
    const value = customTag.trim().replace(/\s+/g, " ");
    if (!value) return;
    if (!tags.some((tag) => tag.toLowerCase() === value.toLowerCase())) onChange([...tags, value]);
    setCustomTag("");
  }
  return <section className={`tagSelector ${compact ? "compact" : ""}`}>
    <div><b>Tags</b><small>Select at least one main tag. Undefined is the default.</small></div>
    <div className="primaryTagGrid">{primaryTags.map((tag) => <button type="button" className={primarySelected.includes(tag) ? "chosen" : ""} key={tag} onClick={() => togglePrimary(tag)}>{tag}</button>)}</div>
    <div className="customTagInput"><input value={customTag} maxLength={30} placeholder="Add a custom tag" onChange={(event) => setCustomTag(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomTag(); } }} /><button type="button" onClick={addCustomTag}>Add</button></div>
    {customTags.length > 0 && <div className="tagRow editable">{customTags.map((tag) => tag === "Cloned" ? <span className="lockedTag" key={tag}>{tag}</span> : <button type="button" key={tag} onClick={() => onChange(tags.filter((item) => item !== tag))}>{tag} ×</button>)}</div>}
  </section>;
}

function EmptyState({ title, text, button, onClick }: { title: string; text: string; button: string; onClick: () => void }) {
  return <section className="emptyState"><div>⌗</div><h3>{title}</h3><p>{text}</p><button onClick={onClick}>{button}</button></section>;
}

function Builder(props: {
  contestants: Contestant[]; name: string; saveState: SaveState; search: string; selectedSeed: number | null; size: number;
  onBack: () => void; onBracket: () => void; onChangeName: (value: string) => void; onChangeSize: (value: number) => void;
  onRandomize: () => void; onImport: (entries: ImportedEntry[]) => void; playMode: PlayMode; tags: string[]; visibility: "private" | "public"; regionNames: string[];
  onRegionNames: (names: string[]) => void; onPlayMode: (mode: PlayMode) => void; onTags: (tags: string[]) => void; onVisibility: (visibility: "private" | "public") => void; onSave: () => void;
  onSearch: (value: string) => void; onSelectSeed: (seed: number | null) => void;
  onUpdateContestant: (seed: number, patch: Partial<Contestant>) => void;
}) {
  const [entryMethod, setEntryMethod] = useState<EntryMethod>("manual");
  const [pastedList, setPastedList] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const selected = props.contestants.find((item) => item.seed === props.selectedSeed);
  const complete = props.contestants.filter((item) => item.name.trim()).length;

  function parseDelimitedRows(raw: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < raw.length; index++) {
      const char = raw[index];
      if (char === '"') {
        if (quoted && raw[index + 1] === '"') { cell += '"'; index++; }
        else quoted = !quoted;
      } else if ((char === "," || char === "\t") && !quoted) {
        row.push(cell.trim()); cell = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && raw[index + 1] === "\n") index++;
        row.push(cell.trim()); cell = "";
        if (row.some(Boolean)) rows.push(row);
        row = [];
      } else cell += char;
    }
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
    return rows;
  }

  function normalizeHeader(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function editDistance(a: string, b: string) {
    const table = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) table[i][0] = i;
    for (let j = 0; j <= b.length; j++) table[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      table[i][j] = Math.min(table[i - 1][j] + 1, table[i][j - 1] + 1, table[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return table[a.length][b.length];
  }

  function headerField(value: string): "name" | "seed" | "description" | "imageUrl" | null {
    const normalized = normalizeHeader(value);
    const aliases = {
      name: ["name", "title", "song", "team", "player", "contestant", "entry", "choice", "item"],
      seed: ["seed", "rank", "ranking", "order", "position", "number", "seednumber"],
      description: ["description", "details", "detail", "subtitle", "summary", "bio", "notes", "album", "caption"],
      imageUrl: ["imageurl", "image", "photo", "photourl", "picture", "pictureurl", "cover", "coverurl", "art", "artwork", "url"],
    } as const;
    for (const [field, values] of Object.entries(aliases) as Array<[keyof typeof aliases, readonly string[]]>) {
      if (values.some((alias) => normalized === alias || (normalized.length >= 4 && editDistance(normalized, alias) <= 2))) return field;
    }
    return null;
  }

  const isImageValue = (value: string) => /^https?:\/\//i.test(value) && (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(value) || /image|photo|cover|artwork|coverartarchive|cdn/i.test(value));
  const isSeedValue = (value: string) => /^#?\d{1,3}$/.test(value.trim());

  function parseSmartImport(raw: string): ImportedEntry[] {
    const rows = parseDelimitedRows(raw).filter((row) => row.some((cell) => cell.trim()));
    if (!rows.length) return [];

    // A single comma-delimited row containing only ordinary text is a list of names.
    if (rows.length === 1 && rows[0].length > 1 && rows[0].every((cell) => !headerField(cell) && !isImageValue(cell) && !isSeedValue(cell))) {
      return rows[0].map((name) => ({ name: name.trim().replace(/^\d+[.)-]?\s*/, "") }));
    }

    const maxColumns = Math.max(...rows.map((row) => row.length));
    if (maxColumns === 1) return rows.map((row) => ({ name: row[0].trim().replace(/^\d+[.)-]?\s*/, "") }));

    const firstFields = rows[0].map(headerField);
    const hasHeader = firstFields.some(Boolean);
    const dataRows = hasHeader ? rows.slice(1) : rows;
    const mapping: Partial<Record<"name" | "seed" | "description" | "imageUrl", number>> = {};
    firstFields.forEach((field, index) => { if (field && mapping[field] === undefined) mapping[field] = index; });

    if (!hasHeader) {
      const columns = Array.from({ length: maxColumns }, (_, column) => dataRows.map((row) => (row[column] ?? "").trim()).filter(Boolean));
      const imageColumn = columns.findIndex((values) => values.length > 0 && values.filter(isImageValue).length / values.length >= 0.5);
      const seedColumn = columns.findIndex((values, index) => index !== imageColumn && values.length > 0 && values.filter(isSeedValue).length / values.length >= 0.75);
      if (imageColumn >= 0) mapping.imageUrl = imageColumn;
      if (seedColumn >= 0) mapping.seed = seedColumn;
      const available = columns.map((_, index) => index).filter((index) => index !== imageColumn && index !== seedColumn);
      const descriptionColumn = available.find((index) => {
        const values = columns[index];
        return values.length > 0 && values.reduce((sum, value) => sum + value.length, 0) / values.length > 42;
      });
      if (descriptionColumn !== undefined) mapping.description = descriptionColumn;
      const nameCandidates = available.filter((index) => index !== descriptionColumn);
      mapping.name = nameCandidates.sort((a, b) => {
        const avgA = columns[a].reduce((sum, value) => sum + value.length, 0) / Math.max(columns[a].length, 1);
        const avgB = columns[b].reduce((sum, value) => sum + value.length, 0) / Math.max(columns[b].length, 1);
        return avgA - avgB;
      })[0] ?? 0;
      if (mapping.description === undefined) {
        const extra = available.find((index) => index !== mapping.name);
        if (extra !== undefined) mapping.description = extra;
      }
    }

    if (mapping.name === undefined) {
      const candidate = Array.from({ length: maxColumns }, (_, index) => index).find((index) => index !== mapping.seed && index !== mapping.imageUrl && index !== mapping.description);
      mapping.name = candidate ?? 0;
    }

    const seen = new Set<string>();
    return dataRows.map((cells) => {
      const name = (cells[mapping.name ?? 0] ?? "").trim().replace(/^\d+[.)-]?\s*/, "");
      const rawSeed = mapping.seed === undefined ? "" : (cells[mapping.seed] ?? "");
      const seed = Number.parseInt(rawSeed.replace(/[^0-9]/g, ""), 10);
      return {
        name,
        seed: Number.isFinite(seed) ? seed : undefined,
        description: mapping.description === undefined ? undefined : (cells[mapping.description] ?? "").trim() || undefined,
        imageUrl: mapping.imageUrl === undefined ? undefined : (cells[mapping.imageUrl] ?? "").trim() || undefined,
      };
    }).filter((entry) => {
      const key = entry.name.toLowerCase();
      if (!entry.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function importText(raw: string) {
    const allEntries = parseSmartImport(raw);
    if (!allEntries.length) return setImportMessage("No bracket entries were found. Name is the only required field.");
    const entries = allEntries.slice(0, 64);
    props.onImport(entries);
    setImportMessage(allEntries.length > 64
      ? "64 entries imported. 128-entry brackets will be available with Premium."
      : `${entries.length} entries imported.`);
  }
  async function uploadFile(file?: File) {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["txt", "csv"].includes(extension)) return setImportMessage("Use a .txt or .csv file for now.");
    importText(await file.text());
  }
  return <>
    <div className="workspace">
      <div className="heading">
        <div><button className="back" onClick={props.onBack}>← My Brackets</button><small>● BRACKET BUILDER</small><h1>Build your bracket</h1><p>{complete} of {props.size} entries added.</p></div>
        <div className="actions"><SaveLabel state={props.saveState} /><button className="secondaryAction" onClick={props.onSave}>Save changes</button><button onClick={props.onBracket}>Open bracket →</button></div>
      </div>
      <div className="grid">
        <section className="panel">
          <Title n="01" title="Bracket Setup" text="Name your bracket and choose the size of the field." />
          <label className="bracketNameLabel">Bracket Name<input autoFocus maxLength={80} placeholder="Enter a bracket name" value={props.name} onChange={(event) => props.onChangeName(event.target.value)} /></label>
          <TagSelector tags={props.tags} onChange={props.onTags} />
          <div className="visibilityChoice"><div><b>Bracket visibility</b><small>Private brackets stay in My Brackets. Public brackets can appear in Explore.</small></div><div><button className={props.visibility === "private" ? "chosen" : ""} onClick={() => props.onVisibility("private")}>Private</button><button className={props.visibility === "public" ? "chosen" : ""} onClick={() => props.onVisibility("public")}>Public</button></div></div>
          <label>Number of entries</label>
          <div className="sizes">{sizes.map((item) => <button className={props.size === item ? "chosen" : ""} onClick={() => props.onChangeSize(item)} key={item}><b>{item}</b><small>{Math.log2(item)} rounds</small></button>)}<button className="premiumSize" disabled title="Premium upgrade coming later"><b>{premiumSize}</b><small>Premium</small></button></div>
          {props.size >= 32 && <div className="regionSetup">
            <div><b>Region names</b><small>Each region contains 16 contestants.</small></div>
            <div className="regionNameGrid">{props.regionNames.map((region, index) => <label key={index}>Region {index + 1}<input value={region} maxLength={24} onChange={(event) => props.onRegionNames(props.regionNames.map((name, nameIndex) => nameIndex === index ? event.target.value : name))} /></label>)}</div>
          </div>}
          <label>How will winners be decided?</label>
          <div className="playModes">
            <PlayModeCard title="Manual" text="You choose every matchup winner." chosen={props.playMode === "manual"} onClick={() => props.onPlayMode("manual")} />
            <PlayModeCard title="Voting" text="Prepare the bracket for audience voting." chosen={props.playMode === "voting"} onClick={() => props.onPlayMode("voting")} />
            <PlayModeCard title="Random" text="Use the randomizer to settle each matchup." chosen={props.playMode === "random"} onClick={() => props.onPlayMode("random")} />
          </div>
          <label>How do you want to add entries?</label>
          <div className="methods">
            <Method icon="✎" title="Enter manually" text="Build the field one seed at a time" active={entryMethod === "manual"} onClick={() => setEntryMethod("manual")} />
            <Method icon="≡" title="Paste a list" text="Paste names or smart comma-delimited rows" active={entryMethod === "paste"} onClick={() => setEntryMethod("paste")} />
            <Method icon="⇧" title="Upload a file" text="Import a TXT or CSV file" active={entryMethod === "upload"} onClick={() => setEntryMethod("upload")} />
          </div>
          {entryMethod === "paste" && <div className="importBox"><textarea placeholder={'Jordan\nLeBron\nKobe\nMagic'} value={pastedList} onChange={(event) => setPastedList(event.target.value)} /><button onClick={() => importText(pastedList)}>Import list</button></div>}
          {entryMethod === "upload" && <div className="importBox uploadBox"><input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={(event) => uploadFile(event.target.files?.[0])} /><small>Name is required. Seed, description, and image URL are optional. Headers may be missing, misspelled, or out of order.</small></div>}
          {importMessage && <p className="importMessage">{importMessage}</p>}
        </section>
        <section className="panel seedPanel">
          <div className="panelHeader"><Title n="02" title="Seed your field" text="Click any seed to edit its entry." /><button onClick={props.onRandomize}>↝ Randomize seeds</button></div>
          <div className="toolbar"><input placeholder="⌕  Search entries" value={props.search} onChange={(event) => props.onSearch(event.target.value)} /><span>{complete}/{props.size}</span></div>
          <div className="players">{props.contestants.filter((item) => item.name.toLowerCase().includes(props.search.toLowerCase())).map((item) => <Player key={item.seed} contestant={item} onClick={() => props.onSelectSeed(item.seed)} />)}</div>
        </section>
      </div>
    </div>
    {selected && <ContestantDrawer contestant={selected} onClose={() => props.onSelectSeed(null)} onUpdate={props.onUpdateContestant} />}
  </>;
}


function parseManageDelimitedRows(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (char === '"') {
      if (quoted && raw[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if ((char === "," || char === "\t") && !quoted) {
      row.push(cell.trim()); cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && raw[index + 1] === "\n") index++;
      row.push(cell.trim()); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function manageHeaderField(value: string): "name" | "seed" | "description" | "imageUrl" | null {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases = {
    name: ["name", "title", "team", "player", "contestant", "entry", "choice", "item", "dad", "character"],
    seed: ["seed", "rank", "ranking", "order", "position", "number"],
    description: ["description", "details", "detail", "subtitle", "summary", "bio", "notes", "show", "series"],
    imageUrl: ["imageurl", "image", "photo", "photourl", "picture", "pictureurl", "cover", "coverurl", "art", "artwork", "url"],
  } as const;
  for (const [field, values] of Object.entries(aliases) as Array<[keyof typeof aliases, readonly string[]]>) {
    if (values.some((alias) => normalized === alias || normalized.includes(alias) || alias.includes(normalized))) return field;
  }
  return null;
}

function parseManageImport(raw: string): ImportedEntry[] {
  const rows = parseManageDelimitedRows(raw).filter((row) => row.some((cell) => cell.trim()));
  if (!rows.length) return [];
  const isUrl = (value: string) => /^https?:\/\//i.test(value.trim());
  const isSeed = (value: string) => /^#?\d{1,3}$/.test(value.trim());
  if (rows.length === 1 && rows[0].length > 1 && rows[0].every((cell) => !manageHeaderField(cell) && !isUrl(cell) && !isSeed(cell))) {
    return rows[0].map((name) => ({ name: name.trim() })).filter((entry) => entry.name);
  }
  const maxColumns = Math.max(...rows.map((row) => row.length));
  if (maxColumns === 1) return rows.map((row) => ({ name: row[0].trim().replace(/^\d+[.)-]?\s*/, "") })).filter((entry) => entry.name);
  const firstFields = rows[0].map(manageHeaderField);
  const hasHeader = firstFields.some(Boolean);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const mapping: Partial<Record<"name" | "seed" | "description" | "imageUrl", number>> = {};
  firstFields.forEach((field, index) => { if (field && mapping[field] === undefined) mapping[field] = index; });
  if (!hasHeader) {
    const columns = Array.from({ length: maxColumns }, (_, column) => dataRows.map((row) => (row[column] ?? "").trim()).filter(Boolean));
    const imageColumn = columns.findIndex((values) => values.length && values.filter(isUrl).length / values.length >= 0.5);
    const seedColumn = columns.findIndex((values, index) => index !== imageColumn && values.length && values.filter(isSeed).length / values.length >= 0.75);
    if (imageColumn >= 0) mapping.imageUrl = imageColumn;
    if (seedColumn >= 0) mapping.seed = seedColumn;
    const available = columns.map((_, index) => index).filter((index) => index !== imageColumn && index !== seedColumn);
    mapping.name = available[0] ?? 0;
    if (available.length > 1) mapping.description = available[1];
  }
  if (mapping.name === undefined) mapping.name = Array.from({ length: maxColumns }, (_, index) => index).find((index) => index !== mapping.seed && index !== mapping.imageUrl && index !== mapping.description) ?? 0;
  const seen = new Set<string>();
  return dataRows.map((cells) => {
    const name = (cells[mapping.name ?? 0] ?? "").trim().replace(/^\d+[.)-]?\s*/, "");
    const seedText = mapping.seed === undefined ? "" : (cells[mapping.seed] ?? "");
    const seed = Number.parseInt(seedText.replace(/[^0-9]/g, ""), 10);
    return {
      name,
      seed: Number.isFinite(seed) ? seed : undefined,
      description: mapping.description === undefined ? undefined : (cells[mapping.description] ?? "").trim() || undefined,
      imageUrl: mapping.imageUrl === undefined ? undefined : (cells[mapping.imageUrl] ?? "").trim() || undefined,
    };
  }).filter((entry) => {
    const key = entry.name.toLowerCase();
    if (!entry.name || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function mergeImportedEntries(current: Contestant[], entries: ImportedEntry[]): Contestant[] {
  const next = current.map((item) => ({ ...item }));
  const usedSeeds = new Set<number>();
  const overwriteQueue = next.map((item) => item.seed);
  for (const entry of entries) {
    let targetIndex = -1;
    if (entry.seed && entry.seed >= 1 && entry.seed <= next.length) targetIndex = next.findIndex((item) => item.seed === entry.seed);
    if (targetIndex < 0) targetIndex = next.findIndex((item) => item.name.trim().toLowerCase() === entry.name.trim().toLowerCase());
    if (targetIndex < 0) targetIndex = next.findIndex((item) => !item.name.trim() && !usedSeeds.has(item.seed));
    if (targetIndex < 0) {
      const seed = overwriteQueue.find((candidate) => !usedSeeds.has(candidate));
      targetIndex = seed ? next.findIndex((item) => item.seed === seed) : -1;
    }
    if (targetIndex < 0) continue;
    const existing = next[targetIndex];
    usedSeeds.add(existing.seed);
    next[targetIndex] = {
      ...existing,
      name: entry.name || existing.name,
      shortName: entry.name || existing.shortName,
      details: entry.description !== undefined ? entry.description : existing.details,
      imageUrl: entry.imageUrl !== undefined ? entry.imageUrl : existing.imageUrl,
    };
  }
  return next;
}

function ManageImportPanel({ size, onImport }: { size: number; onImport: (entries: ImportedEntry[]) => void }) {
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  function apply(raw: string) {
    const entries = parseManageImport(raw).slice(0, size);
    if (!entries.length) return setMessage("No entries found. Name is required; all other fields are optional.");
    onImport(entries);
    setMessage(`${entries.length} entr${entries.length === 1 ? "y" : "ies"} merged. Existing names or specified seeds were updated first.`);
  }
  async function upload(file?: File) {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["txt", "csv"].includes(extension)) return setMessage("Use a .txt or .csv file.");
    apply(await file.text());
  }
  return <section className="manageImportPanel">
    <div><b>Merge contestants</b><small>Upload or paste additions and corrections. Matching names and supplied seeds are updated first; new entries fill empty slots.</small></div>
    <div className="manageImportActions"><input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={(event) => upload(event.target.files?.[0])} /><textarea placeholder="Paste names or comma-delimited rows…" value={text} onChange={(event) => setText(event.target.value)} /><button type="button" onClick={() => apply(text)}>Merge pasted list</button></div>
    {message && <small className="importMessage">{message}</small>}
  </section>;
}

function ManageBracket(props: {
  contestants: Contestant[]; name: string; saveState: SaveState; size: number; regionNames: string[]; playMode: PlayMode; tags: string[]; visibility: "private" | "public"; seedingStyle: SeedingStyle;
  selectedSeed: number | null; onBack: () => void; onOpenBracket: () => void; onSave: () => void;
  onName: (value: string) => void; onRegionNames: (names: string[]) => void; onPlayMode: (mode: PlayMode) => void; onTags: (tags: string[]) => void; onVisibility: (visibility: "private" | "public") => void; onSeedingStyle: (style: SeedingStyle) => void;
  onSelectSeed: (seed: number | null) => void; onUpdateContestant: (seed: number, patch: Partial<Contestant>) => void;
  onSwap: (fromSeed: number, toSeed: number) => void; onToggleLock: (seed: number) => void;
  onRandomizeAll: () => void; onRandomizeRegion: (index: number) => void; onUploadImage: (seed: number, file: File) => void; onMergeImport: (entries: ImportedEntry[]) => void; onDelete: () => void;
  clonedFromId: string | null; clonedFromName: string | null; onOpenOriginal: (id: string) => void;
}) {
  const selected = props.contestants.find((item) => item.seed === props.selectedSeed);
  const [draggedSeed, setDraggedSeed] = useState<number | null>(null);
  const regionCount = props.size >= 32 ? props.size / 16 : 1;
  const names = regionCount === 1 ? ["Field"] : Array.from({ length: regionCount }, (_, index) => props.regionNames[index] || `Region ${index + 1}`);

  return <div className="managePage">
    <div className="manageTopbar">
      <div><small>BRACKET ADMIN</small><input className="manageName" value={props.name} onChange={(event) => props.onName(event.target.value)} /></div>
      <div className="manageTopActions"><SaveLabel state={props.saveState} /><button className="secondaryAction" onClick={props.onSave}>Save changes</button><button onClick={props.onOpenBracket}>Open bracket →</button></div>
    </div>
    {props.clonedFromId && <button className="manageCloneLineage" onClick={() => props.onOpenOriginal(props.clonedFromId as string)}>Cloned from {props.clonedFromName || "original bracket"} — view original ↗</button>}

    <div className="manageSettingsGrid">
      <section className="manageSettingsCard manageIdentityCard">
        <div className="manageSectionHeading"><span>01</span><div><b>Bracket settings</b><small>Control where this bracket appears and how it is played.</small></div></div>
        <div className="manageFieldGrid">
          <div className="manageTagsField"><TagSelector tags={props.tags} onChange={props.onTags} compact /></div>
          <div className="visibilityChoice compact"><div><b>Visibility</b><small>Only public brackets appear in Explore.</small></div><div><button className={props.visibility === "private" ? "chosen" : ""} onClick={() => props.onVisibility("private")}>Private</button><button className={props.visibility === "public" ? "chosen" : ""} onClick={() => props.onVisibility("public")}>Public</button></div></div>
          <label className="managePlayMode"><span>Play mode</span><select value={props.playMode} onChange={(event) => props.onPlayMode(event.target.value as PlayMode)}><option value="manual">Manual</option><option value="voting">Voting</option><option value="random">Random</option></select></label>
        </div>
      </section>

      <section className="manageSettingsCard manageImportCard">
        <div className="manageSectionHeading"><span>02</span><div><b>Update contestants</b><small>Merge a file or pasted list into the existing field.</small></div></div>
        <ManageImportPanel size={props.size} onImport={props.onMergeImport} />
      </section>

    </div>

    <div className="regionAdminToolbar">
      <div><small>SEED YOUR FIELD</small><b>{regionCount === 1 ? "Contestants" : "Regions"}</b><p>Drag cards to reseed or move contestants. Lock favorites before randomizing.</p></div>
      <div className="regionAdminTools">
        {props.size >= 32 && <label className="compactSeedingSelect">
          <span>Regional seeding</span>
          <select value={props.seedingStyle} onChange={(event) => props.onSeedingStyle(event.target.value as SeedingStyle)} aria-label="Regional seeding style">
            <option value="overall">Overall 1–{props.size}</option>
            <option value="regional">Regional 1–16</option>
          </select>
        </label>}
        <button className="secondaryAction" onClick={props.onRandomizeAll}>↝ Randomize all unlocked</button>
      </div>
    </div>

    <div className={`regionAdminGrid regions-${regionCount}`}>
      {names.map((regionName, regionIndex) => {
        const start = regionIndex * 16;
        const entries = props.contestants.slice(start, start + (regionCount === 1 ? props.size : 16));
        return <section className="regionAdmin" key={regionIndex}>
          <div className="regionAdminHeader">
            {regionCount > 1 ? <input value={regionName} onChange={(event) => props.onRegionNames(names.map((name, index) => index === regionIndex ? event.target.value : name))} /> : <h2>{regionName}</h2>}
            <button onClick={() => regionCount === 1 ? props.onRandomizeAll() : props.onRandomizeRegion(regionIndex)}>{regionCount === 1 ? "Randomize field" : "Randomize region"}</button>
          </div>
          <div className="adminContestants">
            {entries.map((contestant) => <article
              className={`adminContestant ${contestant.locked ? "locked" : ""}`}
              draggable
              key={contestant.seed}
              onDragStart={() => setDraggedSeed(contestant.seed)}
              onDragEnd={() => setDraggedSeed(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); if (draggedSeed) props.onSwap(draggedSeed, contestant.seed); setDraggedSeed(null); }}
            >
              <button className="adminCardMain" onClick={() => props.onSelectSeed(contestant.seed)}>
                <ContestantPhoto contestant={contestant} />
                <span className="adminSeed">{displayedSeed(contestant, props.size, props.seedingStyle)}</span>
                <span><b>{contestant.name || `Seed ${displayedSeed(contestant, props.size, props.seedingStyle)}`}</b><small>{contestant.details || "Add details and an image"}</small></span>
              </button>
              <button className="lockButton" title={contestant.locked ? "Unlock seed" : "Lock seed"} onClick={() => props.onToggleLock(contestant.seed)}>{contestant.locked ? "🔒" : "○"}</button>
            </article>)}
          </div>
        </section>;
      })}
    </div>
    <section className="dangerZone"><div><b>Delete bracket</b><p>Permanently removes the bracket, contestants, matchups and votes.</p></div><button onClick={props.onDelete}>Delete bracket</button></section>
    {selected && <ContestantDrawer contestant={selected} onClose={() => props.onSelectSeed(null)} onUpdate={props.onUpdateContestant} onUpload={props.onUploadImage} />}
  </div>;
}

function ContestantDrawer({ contestant, onClose, onUpdate, onUpload }: {
  contestant: Contestant; onClose: () => void; onUpdate: (seed: number, patch: Partial<Contestant>) => void;
  onUpload?: (seed: number, file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  function chooseFile(file?: File) {
    if (!file || !file.type.startsWith("image/")) return;
    onUpload?.(contestant.seed, file);
  }
  return <><button className="scrim" aria-label="Close editor" onClick={onClose} /><aside>
    <div className="asideTitle"><div><small>SEED {contestant.seed}</small><h2>Edit contestant</h2></div><button onClick={onClose}>×</button></div>
    <div className="photo uploadPhoto" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseFile(event.dataTransfer.files?.[0]); }}>
      <i style={{ background: contestant.accentColor }}>{contestant.imageUrl ? <img src={contestant.imageUrl} alt="" /> : initials(contestant.name)}</i>
      <div><button type="button" onClick={() => inputRef.current?.click()}>Upload photo</button><small>Choose a file or drag one here.</small><input ref={inputRef} hidden type="file" accept="image/*" onChange={(event) => chooseFile(event.target.files?.[0])} /></div>
    </div>
    <label>Contestant name<input autoFocus value={contestant.name} onChange={(event) => onUpdate(contestant.seed, { name: event.target.value, shortName: contestant.shortName || event.target.value })} /></label>
    <label>Short name<input value={contestant.shortName} onChange={(event) => onUpdate(contestant.seed, { shortName: event.target.value })} /><small>Used where bracket space is tight.</small></label>
    <label>Subtitle or details<input value={contestant.details} onChange={(event) => onUpdate(contestant.seed, { details: event.target.value })} /></label>
    <label>Image URL<input value={contestant.imageUrl} onChange={(event) => onUpdate(contestant.seed, { imageUrl: event.target.value })} /></label>
    <div className="preview"><small>CARD PREVIEW</small><Player contestant={contestant} /></div>
    <div className="asideActions"><button onClick={() => onUpdate(contestant.seed, { name: "", shortName: "", details: "", imageUrl: "" })}>Clear seed</button><button onClick={onClose}>Done</button></div>
  </aside></>;
}


function AdminSettings({ settings, onChange, onReset }: { settings: AppSettings; onChange: (settings: AppSettings) => void; onReset: () => void }) {
  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    onChange({ ...settings, [key]: value });
  }

  return <div className="workspace adminSettingsPage">
    <div className="adminSettingsHeading"><div><small>APPLICATION CONTROL PANEL</small><h1>Admin Settings</h1><p>Tune the bracket canvas experience. Changes apply immediately and are saved in this browser.</p></div><button onClick={onReset}>Reset defaults</button></div>
    <section className="settingsPanel">
      <div className="settingsPanelTitle"><h2>Canvas Motion</h2><p>Control how the bracket responds when users drag and release it.</p></div>
      <SettingSlider label="Friction" help="Higher friction stops the canvas faster." value={settings.frictionStrength} min={20} max={220} step={5} display={`${settings.frictionStrength}%`} onChange={(value) => set("frictionStrength", value)} />
      <SettingSlider label="Momentum sensitivity" help="Controls how strongly a flick carries into the glide." value={settings.momentumSensitivity} min={0.25} max={2} step={0.05} display={`${settings.momentumSensitivity.toFixed(2)}×`} onChange={(value) => set("momentumSensitivity", value)} />
    </section>
    <section className="settingsPanel">
      <div className="settingsPanelTitle"><h2>Canvas Zoom</h2><p>Set the starting zoom and the limits available to users.</p></div>
      <SettingSlider label="Default zoom" help="Starting zoom before Fit or Center is used." value={settings.defaultZoom} min={0.3} max={1.2} step={0.01} display={`${Math.round(settings.defaultZoom * 100)}%`} onChange={(value) => set("defaultZoom", value)} />
      <SettingSlider label="Minimum zoom" help="How far users can zoom out." value={settings.minimumZoom} min={0.1} max={0.6} step={0.01} display={`${Math.round(settings.minimumZoom * 100)}%`} onChange={(value) => set("minimumZoom", Math.min(value, settings.maximumZoom - 0.05))} />
      <SettingSlider label="Maximum zoom" help="How far users can zoom in." value={settings.maximumZoom} min={0.7} max={2} step={0.01} display={`${Math.round(settings.maximumZoom * 100)}%`} onChange={(value) => set("maximumZoom", Math.max(value, settings.minimumZoom + 0.05))} />
      <SettingSlider label="Double-click / double-tap zoom" help="How much closer each double-click or double-tap moves the bracket." value={settings.doubleTapZoomPercent} min={5} max={100} step={5} display={`${settings.doubleTapZoomPercent}%`} onChange={(value) => set("doubleTapZoomPercent", value)} />
    </section>
    <section className="settingsPanel">
      <div className="settingsPanelTitle"><h2>Canvas Background</h2><p>Choose the canvas color, pattern, and tint behind every bracket.</p></div>
      <label className="settingRow settingColorRow"><div><b>Background color</b><small>The base color behind the bracket.</small></div><input type="color" value={settings.canvasBackgroundColor} onChange={(event) => set("canvasBackgroundColor", event.target.value)} /><output>{settings.canvasBackgroundColor.toUpperCase()}</output></label>
      <label className="settingRow"><div><b>Background pattern</b><small>Add a subtle guide pattern behind the bracket.</small></div><select value={settings.canvasPattern} onChange={(event) => set("canvasPattern", event.target.value as AppSettings["canvasPattern"])}><option value="grid">Grid</option><option value="dots">Dots</option><option value="crosshatch">Crosshatch</option><option value="none">None</option></select><output>{settings.canvasPattern}</output></label>
      <SettingSlider label="Background tint" help="Adds a soft white tint over the selected background." value={settings.canvasTint} min={0} max={30} step={1} display={`${settings.canvasTint}%`} onChange={(value) => set("canvasTint", value)} />
    </section>
    <section className="settingsPanel">
      <div className="settingsPanelTitle"><h2>Bracket Cards</h2><p>Adjust the amount of emphasis a matchup receives on hover.</p></div>
      <SettingSlider label="Matchup hover size" help="The scale applied when a user hovers over a matchup." value={settings.matchupHoverScale} min={1} max={1.18} step={0.01} display={`${Math.round((settings.matchupHoverScale - 1) * 100)}% larger`} onChange={(value) => set("matchupHoverScale", value)} />
    </section>
  </div>;
}

function SettingSlider({ label, help, value, min, max, step, display, onChange }: { label: string; help: string; value: number; min: number; max: number; step: number; display: string; onChange: (value: number) => void }) {
  return <label className="settingRow"><div><b>{label}</b><small>{help}</small></div><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /><output>{display}</output></label>;
}

function Bracket({ tournamentId, contestants, name, saveState, size, winners, regionNames, seedingStyle, settings, editable, participants, onSave, onClear, onEdit, onWinner }: {
  tournamentId: string | null; contestants: Contestant[]; name: string; saveState: SaveState; size: number; winners: WinnerMap; regionNames: string[]; seedingStyle: SeedingStyle; settings: AppSettings; editable: boolean;
  participants: (round: number, match: number) => Array<Contestant | null>; onSave: () => void; onClear: () => void; onEdit: () => void;
  onWinner: (round: number, match: number, contestant: Contestant) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef({
    active: false,
    pointerId: 0,
    x: 0,
    y: 0,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
    velocityX: 0,
    velocityY: 0,
  });
  const momentumFrameRef = useRef<number | null>(null);
  const panRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(settings.defaultZoom);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef({
    active: false,
    startDistance: 0,
    startScale: settings.defaultZoom,
    worldX: 0,
    worldY: 0,
  });
  const tapRef = useRef({ lastTime: 0, x: 0, y: 0 });
  const suppressDoubleClickUntilRef = useRef(0);
  const [scale, setScale] = useState(settings.defaultZoom);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selectedRegion, setSelectedRegion] = useState("full");
  const [nextMatchupMode, setNextMatchupMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(nextMatchupModeKey) === "true";
  });
  useEffect(() => {
    setNextMatchupMode(window.localStorage.getItem(nextMatchupModeKey) === "true");
  }, [tournamentId]);
  const rounds = Math.log2(size);
  const sideRounds = rounds - 1;
  const firstRoundMatchesPerSide = size / 4;
  const cardWidth = 280;
  const matchupHeight = 164;
  const roundGap = 355;
  const rowGap = size >= 64 ? 198 : size >= 32 ? 210 : 226;
  const canvasWidth = 330 + sideRounds * roundGap * 2;
  const canvasHeight = Math.max(560, firstRoundMatchesPerSide * rowGap + 80);
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  const championId = winners[matchKey(rounds, 0)];
  const champion = contestants.find((item) => item.id === championId);
  const finalists = participants(rounds, 0);
  const regionCount = size >= 32 ? size / 16 : 0;
  const regionsPerSide = regionCount / 2;
  const regionRound = size >= 32 ? 4 : 0;
  const effectiveRegionNames = regionCount ? Array.from({ length: regionCount }, (_, index) => regionNames[index]?.trim() || `Region ${index + 1}`) : [];

  const clampPan = useCallback((nextPan: { x: number; y: number }, nextScale = scaleRef.current) => {
    const viewport = viewportRef.current;
    if (!viewport) return nextPan;
    const scaledWidth = canvasWidth * nextScale;
    const scaledHeight = canvasHeight * nextScale;
    const visibleX = Math.min(150, viewport.clientWidth * 0.34, scaledWidth * 0.34);
    const visibleY = Math.min(120, viewport.clientHeight * 0.34, scaledHeight * 0.34);
    const minX = visibleX - scaledWidth;
    const maxX = viewport.clientWidth - visibleX;
    const minY = visibleY - scaledHeight;
    const maxY = viewport.clientHeight - visibleY;
    return {
      x: Math.min(maxX, Math.max(minX, nextPan.x)),
      y: Math.min(maxY, Math.max(minY, nextPan.y)),
    };
  }, [canvasHeight, canvasWidth]);

  const updatePan = useCallback((nextPan: { x: number; y: number }, nextScale = scaleRef.current) => {
    const bounded = clampPan(nextPan, nextScale);
    panRef.current = bounded;
    setPan(bounded);
  }, [clampPan]);

  const updateScale = useCallback((nextScale: number) => {
    scaleRef.current = nextScale;
    setScale(nextScale);
  }, []);

  const stopMomentum = useCallback(() => {
    if (momentumFrameRef.current !== null) {
      cancelAnimationFrame(momentumFrameRef.current);
      momentumFrameRef.current = null;
    }
  }, []);

  const startMomentum = useCallback((velocityX: number, velocityY: number) => {
    stopMomentum();
    let vx = velocityX * settings.momentumSensitivity;
    let vy = velocityY * settings.momentumSensitivity;
    let previousTime = performance.now();

    const glide = (time: number) => {
      const elapsed = Math.min(32, time - previousTime);
      previousTime = time;
      const frameFactor = elapsed / 16.667;
      const frictionRetention = Math.max(0.72, Math.min(0.98, 1 - settings.frictionStrength / 1000));
      const friction = Math.pow(frictionRetention, frameFactor);
      vx *= friction;
      vy *= friction;

      if (Math.hypot(vx, vy) < 0.018) {
        momentumFrameRef.current = null;
        return;
      }

      updatePan({
        x: panRef.current.x + vx * elapsed,
        y: panRef.current.y + vy * elapsed,
      });
      momentumFrameRef.current = requestAnimationFrame(glide);
    };

    if (Math.hypot(vx, vy) >= 0.018) momentumFrameRef.current = requestAnimationFrame(glide);
  }, [settings.frictionStrength, settings.momentumSensitivity, stopMomentum, updatePan]);

  const matchCenters = useMemo(() => {
    const values = new Map<string, { x: number; y: number }>();
    for (const side of ["left", "right"] as const) {
      const matchOffset = side === "left" ? 0 : firstRoundMatchesPerSide;
      for (let index = 0; index < firstRoundMatchesPerSide; index++) {
        const match = matchOffset + index;
        const x = side === "left" ? centerX - sideRounds * roundGap : centerX + sideRounds * roundGap;
        const y = 70 + matchupHeight / 2 + index * rowGap;
        values.set(`${side}-1-${match}`, { x, y });
      }
      for (let round = 2; round <= sideRounds; round++) {
        const count = size / 2 ** (round + 1);
        const roundOffset = side === "left" ? 0 : count;
        for (let localMatch = 0; localMatch < count; localMatch++) {
          const match = roundOffset + localMatch;
          const previousOffset = side === "left" ? 0 : count * 2;
          const childOne = values.get(`${side}-${round - 1}-${previousOffset + localMatch * 2}`);
          const childTwo = values.get(`${side}-${round - 1}-${previousOffset + localMatch * 2 + 1}`);
          const x = side === "left"
            ? centerX - (sideRounds - round + 1) * roundGap
            : centerX + (sideRounds - round + 1) * roundGap;
          values.set(`${side}-${round}-${match}`, { x, y: ((childOne?.y ?? centerY) + (childTwo?.y ?? centerY)) / 2 });
        }
      }
    }
    return values;
  }, [centerX, centerY, firstRoundMatchesPerSide, rowGap, roundGap, sideRounds, size]);

  const fitCanvas = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const padding = 12;
    const nextScale = Math.min(settings.maximumZoom, Math.max(settings.minimumZoom, Math.min((viewport.clientWidth - padding) / canvasWidth, (viewport.clientHeight - padding) / canvasHeight)));
    updateScale(nextScale);
    stopMomentum();
    updatePan({
      x: (viewport.clientWidth - canvasWidth * nextScale) / 2,
      y: (viewport.clientHeight - canvasHeight * nextScale) / 2,
    });
  }, [canvasHeight, canvasWidth, settings.maximumZoom, settings.minimumZoom, stopMomentum, updatePan, updateScale]);

  const fitBounds = useCallback((bounds: { minX: number; minY: number; maxX: number; maxY: number }) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const padding = 18;
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const nextScale = Math.min(settings.maximumZoom, Math.max(settings.minimumZoom, Math.min((viewport.clientWidth - padding * 2) / width, (viewport.clientHeight - padding * 2) / height)));
    updateScale(nextScale);
    stopMomentum();
    updatePan({
      x: (viewport.clientWidth - width * nextScale) / 2 - bounds.minX * nextScale,
      y: (viewport.clientHeight - height * nextScale) / 2 - bounds.minY * nextScale,
    });
  }, [settings.maximumZoom, settings.minimumZoom, stopMomentum, updatePan, updateScale]);

  const getRegionBounds = useCallback((regionIndex: number) => {
    const side = regionIndex < regionsPerSide ? "left" : "right";
    const sideRegion = regionIndex % regionsPerSide;
    const firstRoundStart = (side === "left" ? 0 : firstRoundMatchesPerSide) + sideRegion * 8;
    const points: Array<{ x: number; y: number }> = [];
    for (let round = 1; round <= regionRound; round++) {
      const matchesInRegion = 2 ** (regionRound - round);
      const sideRoundCount = size / 2 ** (round + 1);
      const sideOffset = side === "left" ? 0 : sideRoundCount;
      const localStart = sideRegion * matchesInRegion;
      for (let local = 0; local < matchesInRegion; local++) {
        const point = matchCenters.get(`${side}-${round}-${sideOffset + localStart + local}`);
        if (point) points.push(point);
      }
    }
    if (!points.length) return null;
    const minX = Math.min(...points.map((point) => point.x)) - cardWidth / 2 - 26;
    const maxX = Math.max(...points.map((point) => point.x)) + cardWidth / 2 + 26;
    const minY = Math.min(...points.map((point) => point.y)) - matchupHeight / 2 - 58;
    const maxY = Math.max(...points.map((point) => point.y)) + matchupHeight / 2 + 26;
    return { minX, minY, maxX, maxY, firstRoundStart };
  }, [cardWidth, firstRoundMatchesPerSide, matchCenters, matchupHeight, regionRound, regionsPerSide, size]);

  const setNextMode = useCallback((enabled: boolean) => {
    setNextMatchupMode(enabled);
    window.localStorage.setItem(nextMatchupModeKey, String(enabled));
  }, []);

  const leaveNextMatchupMode = useCallback(() => {
    if (nextMatchupMode) setNextMode(false);
  }, [nextMatchupMode, setNextMode]);

  const fitRegion = useCallback((regionIndex: number) => {
    const bounds = getRegionBounds(regionIndex);
    if (!bounds) return;
    leaveNextMatchupMode();
    setSelectedRegion(String(regionIndex));
    fitBounds(bounds);
  }, [fitBounds, getRegionBounds, leaveNextMatchupMode]);

  const finalStageLabel = size === 128 ? "Final Eight" : size === 64 ? "Final Four" : "Championship";
  const finalStageOuterRounds = Math.max(0, sideRounds - regionRound);
  const finalStageHalfWidth = Math.max(roundGap + cardWidth, finalStageOuterRounds * roundGap + cardWidth);
  const finalStageBounds = useMemo(() => ({
    minX: centerX - finalStageHalfWidth,
    minY: centerY - 430,
    maxX: centerX + finalStageHalfWidth,
    maxY: centerY + 430,
  }), [centerX, centerY, finalStageHalfWidth]);

  const fitFinalStage = useCallback((preserveNextMode = false) => {
    if (!preserveNextMode) leaveNextMatchupMode();
    setSelectedRegion("final-stage");
    fitBounds(finalStageBounds);
  }, [finalStageBounds, fitBounds, leaveNextMatchupMode]);

  const nextMatchup = useMemo(() => {
    const candidates: Array<{ round: number; match: number; seed: number }> = [];
    for (let round = 1; round <= rounds; round++) {
      const count = size / 2 ** round;
      for (let match = 0; match < count; match++) {
        const options = participants(round, match);
        if (options[0] && options[1] && !winners[matchKey(round, match)]) {
          candidates.push({ round, match, seed: Math.min(displayedSeed(options[0], size, seedingStyle), displayedSeed(options[1], size, seedingStyle)) });
        }
      }
      if (candidates.length) break;
    }
    return candidates.sort((a, b) => a.seed - b.seed || a.match - b.match)[0] ?? null;
  }, [participants, rounds, seedingStyle, size, winners]);

  const focusNextMatchup = useCallback(() => {
    if (!nextMatchup) {
      fitFinalStage(true);
      return;
    }
    if (nextMatchup.round === rounds) {
      fitBounds({ minX: centerX - 250, minY: centerY - 255, maxX: centerX + 250, maxY: centerY + 255 });
      return;
    }
    const totalCount = size / 2 ** nextMatchup.round;
    const sideCount = totalCount / 2;
    const side = nextMatchup.match < sideCount ? "left" : "right";
    const center = matchCenters.get(`${side}-${nextMatchup.round}-${nextMatchup.match}`);
    if (!center) return;
    setSelectedRegion("next");
    fitBounds({ minX: center.x - cardWidth / 2 - 28, minY: center.y - matchupHeight / 2 - 54, maxX: center.x + cardWidth / 2 + 28, maxY: center.y + matchupHeight / 2 + 28 });
  }, [cardWidth, centerX, centerY, fitBounds, fitFinalStage, matchCenters, matchupHeight, nextMatchup, rounds, size]);

  const regionSeparatorYs = useMemo(() => {
    if (regionCount <= 2) return [];
    const bounds = Array.from({ length: regionsPerSide }, (_, index) => getRegionBounds(index)).filter((value): value is NonNullable<ReturnType<typeof getRegionBounds>> => Boolean(value)).sort((a, b) => a.minY - b.minY);
    return bounds.slice(0, -1).map((boundsItem, index) => (boundsItem.maxY + bounds[index + 1].minY) / 2);
  }, [getRegionBounds, regionCount, regionsPerSide]);

  useEffect(() => {
    fitCanvas();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(fitCanvas);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fitCanvas]);

  const winnersSignature = JSON.stringify(winners);
  useEffect(() => {
    if (!nextMatchupMode) return;
    const timer = window.setTimeout(() => focusNextMatchup(), 80);
    return () => window.clearTimeout(timer);
  }, [focusNextMatchup, nextMatchupMode, winnersSignature]);

  useEffect(() => () => stopMomentum(), [stopMomentum]);
  useEffect(() => { scaleRef.current = scale; }, [scale]);

  function toggleNextMatchupMode() {
    const enabled = !nextMatchupMode;
    setNextMode(enabled);
    if (enabled) window.setTimeout(() => focusNextMatchup(), 0);
    else if (selectedRegion === "next") setSelectedRegion("full");
  }

  function zoomBy(amount: number, originX?: number, originY?: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const pointX = originX ?? rect.left + rect.width / 2;
    const pointY = originY ?? rect.top + rect.height / 2;
    const localX = pointX - rect.left;
    const localY = pointY - rect.top;
    const nextScale = Math.min(settings.maximumZoom, Math.max(settings.minimumZoom, scale + amount));
    const worldX = (localX - pan.x) / scale;
    const worldY = (localY - pan.y) / scale;
    stopMomentum();
    updateScale(nextScale);
    updatePan({ x: localX - worldX * nextScale, y: localY - worldY * nextScale });
  }

  function zoomInAtPoint(clientX: number, clientY: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const currentScale = scaleRef.current;
    const nextScale = Math.min(settings.maximumZoom, currentScale * (1 + settings.doubleTapZoomPercent / 100));
    if (nextScale <= currentScale) return;
    const worldX = (localX - panRef.current.x) / currentScale;
    const worldY = (localY - panRef.current.y) / currentScale;
    stopMomentum();
    updateScale(nextScale);
    updatePan({
      x: localX - worldX * nextScale,
      y: localY - worldY * nextScale,
    });
  }

  function pointerPair() {
    return Array.from(pointersRef.current.entries()).slice(0, 2);
  }

  function beginPinch() {
    const viewport = viewportRef.current;
    const pair = pointerPair();
    if (!viewport || pair.length < 2) return;
    const [, first] = pair[0];
    const [, second] = pair[1];
    const rect = viewport.getBoundingClientRect();
    const midpointX = (first.x + second.x) / 2 - rect.left;
    const midpointY = (first.y + second.y) / 2 - rect.top;
    const currentScale = scaleRef.current;
    pinchRef.current = {
      active: true,
      startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      startScale: currentScale,
      worldX: (midpointX - panRef.current.x) / currentScale,
      worldY: (midpointY - panRef.current.y) / currentScale,
    };
    dragRef.current.active = false;
    stopMomentum();
    viewport.classList.add("dragging");
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button, select, input, textarea, .viewportControls")) return;
    event.preventDefault();
    stopMomentum();
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);

    if (pointersRef.current.size >= 2) {
      beginPinch();
      return;
    }

    const now = performance.now();
    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: panRef.current.x,
      startY: panRef.current.y,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: now,
      velocityX: 0,
      velocityY: 0,
    };
    event.currentTarget.classList.add("dragging");
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pinchRef.current.active && pointersRef.current.size >= 2) {
      event.preventDefault();
      const viewport = viewportRef.current;
      const pair = pointerPair();
      if (!viewport || pair.length < 2) return;
      const [, first] = pair[0];
      const [, second] = pair[1];
      const rect = viewport.getBoundingClientRect();
      const midpointX = (first.x + second.x) / 2 - rect.left;
      const midpointY = (first.y + second.y) / 2 - rect.top;
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const nextScale = Math.min(
        settings.maximumZoom,
        Math.max(settings.minimumZoom, pinchRef.current.startScale * (distance / pinchRef.current.startDistance)),
      );
      updateScale(nextScale);
      updatePan({
        x: midpointX - pinchRef.current.worldX * nextScale,
        y: midpointY - pinchRef.current.worldY * nextScale,
      });
      return;
    }

    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    const now = performance.now();
    const elapsed = Math.max(1, now - drag.lastTime);
    const instantVelocityX = (event.clientX - drag.lastX) / elapsed;
    const instantVelocityY = (event.clientY - drag.lastY) / elapsed;
    drag.velocityX = drag.velocityX * 0.68 + instantVelocityX * 0.32;
    drag.velocityY = drag.velocityY * 0.68 + instantVelocityY * 0.32;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastTime = now;
    updatePan({ x: drag.startX + event.clientX - drag.x, y: drag.startY + event.clientY - drag.y });
  }

  function stopDragging(event: ReactPointerEvent<HTMLDivElement>) {
    const wasPinching = pinchRef.current.active;
    const drag = dragRef.current;
    pointersRef.current.delete(event.pointerId);

    if (wasPinching) {
      pinchRef.current.active = false;
      drag.active = false;
      if (pointersRef.current.size === 1) {
        const [remainingId, remaining] = Array.from(pointersRef.current.entries())[0];
        const now = performance.now();
        dragRef.current = {
          active: true,
          pointerId: remainingId,
          x: remaining.x,
          y: remaining.y,
          startX: panRef.current.x,
          startY: panRef.current.y,
          lastX: remaining.x,
          lastY: remaining.y,
          lastTime: now,
          velocityX: 0,
          velocityY: 0,
        };
      } else {
        event.currentTarget.classList.remove("dragging");
      }
      return;
    }

    if (!drag.active || drag.pointerId !== event.pointerId) return;
    drag.active = false;
    event.currentTarget.classList.remove("dragging");

    const movement = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
    if (event.pointerType === "touch" && movement < 12) {
      const now = performance.now();
      const previousTap = tapRef.current;
      const closeToPreviousTap = Math.hypot(event.clientX - previousTap.x, event.clientY - previousTap.y) < 32;
      if (now - previousTap.lastTime < 350 && closeToPreviousTap) {
        tapRef.current = { lastTime: 0, x: 0, y: 0 };
        suppressDoubleClickUntilRef.current = Date.now() + 500;
        zoomInAtPoint(event.clientX, event.clientY);
        return;
      }
      tapRef.current = { lastTime: now, x: event.clientX, y: event.clientY };
    }

    const idleFor = performance.now() - drag.lastTime;
    if (movement >= 12 && idleFor < 90) startMomentum(drag.velocityX, drag.velocityY);
  }

  function connectorPath(from: { x: number; y: number }, to: { x: number; y: number }, side: "left" | "right") {
    const startX = side === "left" ? from.x + cardWidth / 2 : from.x - cardWidth / 2;
    const endX = side === "left" ? to.x - cardWidth / 2 : to.x + cardWidth / 2;
    const bendX = (startX + endX) / 2;
    return `M ${startX} ${from.y} H ${bendX} V ${to.y} H ${endX}`;
  }

  const roundLabel = (round: number) => round === sideRounds ? "Semifinal" : round === 1 ? `Round of ${size}` : `Round of ${size / 2 ** (round - 1)}`;
  const finalistY = [centerY - 160, centerY + 160];

  return <div className="bracketPage canvasPage" style={{ "--matchup-hover-scale": settings.matchupHoverScale } as CSSProperties}>
    <div className="bracketHeading canvasHeading">
      <div className="canvasTitle">
        <h1>{name}</h1>
        <p>Drag to move. Scroll or pinch to zoom. Double-click or double-tap to zoom toward that point.</p>
      </div>
      <div className="canvasActions">
        {!editable && <span className="readOnlyBadge">View only</span>}
        {editable && <button className="compactAction clearBracketAction" onClick={onClear}>Clear</button>}
        {editable && <button className="compactAction darkSecondary" onClick={onEdit}>Edit bracket</button>}
        {editable && <div className="saveActionGroup"><button className="compactAction primaryAction" onClick={onSave}>Save bracket</button><SaveLabel state={saveState} /></div>}
      </div>
    </div>
    <div
      className={`bracketViewport pattern-${settings.canvasPattern}`}
      style={{ "--canvas-bg": settings.canvasBackgroundColor, "--canvas-tint": settings.canvasTint / 100 } as CSSProperties}
      ref={viewportRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onDoubleClick={(event) => {
        if (Date.now() < suppressDoubleClickUntilRef.current) return;
        if ((event.target as HTMLElement).closest("button, select, .viewportControls")) return;
        zoomInAtPoint(event.clientX, event.clientY);
      }}
      onWheel={(event) => { event.preventDefault(); zoomBy(event.deltaY > 0 ? -0.07 : 0.07, event.clientX, event.clientY); }}
    >
      <div className="canvasOverlayNav">
        {regionCount > 0 && <select className="regionSelect" aria-label="Choose region" value={selectedRegion === "next" ? "next" : selectedRegion} onChange={(event) => {
          const value = event.target.value;
          if (value === "full") { leaveNextMatchupMode(); setSelectedRegion(value); fitCanvas(); }
          else if (value === "next") { setNextMode(true); focusNextMatchup(); }
          else if (value === "final-stage") fitFinalStage();
          else fitRegion(Number(value));
        }}>
          <option value="full">All</option>
          <option value="next">Next matchup</option>
          {effectiveRegionNames.map((region, index) => <option value={index} key={index}>{region}</option>)}
          <option value="final-stage">{finalStageLabel}</option>
        </select>}
        <button
          className={`nextMatchupButton ${nextMatchupMode ? "active" : ""}`}
          onClick={toggleNextMatchupMode}
          aria-pressed={nextMatchupMode}
          title={nextMatchupMode ? "Turn off automatic next-matchup focus" : "Turn on automatic next-matchup focus"}
        >
          {nextMatchup ? `${nextMatchupMode ? "Following" : "Next"}: Round ${nextMatchup.round}, Seed ${nextMatchup.seed}` : nextMatchupMode ? "Following: Complete" : "Bracket complete"}
        </button>
      </div>
      <div className="viewportControls" aria-label="Bracket canvas controls">
        <button onClick={() => zoomBy(-0.1)} aria-label="Zoom out">−</button>
        <span>{Math.round(scale * 100)}%</span>
        <button onClick={() => zoomBy(0.1)} aria-label="Zoom in">＋</button>
        <button onClick={fitCanvas}>Center</button>
      </div>
      <div className="bracketCanvas" style={{ width: canvasWidth, height: canvasHeight, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}>
        {regionCount > 0 && <div className="regionAxes" aria-hidden="true"><i className="regionAxis vertical" style={{ left: centerX }} />{regionSeparatorYs.map((axisY, index) => <i className="regionAxis horizontal" style={{ top: axisY }} key={index} />)}</div>}
        <svg className="bracketConnectors" width={canvasWidth} height={canvasHeight} aria-hidden="true">
          {(["left", "right"] as const).flatMap((side) => {
            const paths: ReactNode[] = [];
            for (let round = 1; round < sideRounds; round++) {
              const currentCount = size / 2 ** (round + 2);
              const currentOffset = side === "left" ? 0 : currentCount;
              const childOffset = side === "left" ? 0 : currentCount * 2;
              for (let match = 0; match < currentCount; match++) {
                const parent = matchCenters.get(`${side}-${round + 1}-${currentOffset + match}`);
                const childOne = matchCenters.get(`${side}-${round}-${childOffset + match * 2}`);
                const childTwo = matchCenters.get(`${side}-${round}-${childOffset + match * 2 + 1}`);
                if (parent && childOne) paths.push(<path key={`${side}-${round}-${match}-a`} d={connectorPath(childOne, parent, side)} />);
                if (parent && childTwo) paths.push(<path key={`${side}-${round}-${match}-b`} d={connectorPath(childTwo, parent, side)} />);
              }
            }
            const semifinal = matchCenters.get(`${side}-${sideRounds}-${side === "left" ? 0 : 1}`);
            if (semifinal) {
              const target = { x: centerX, y: side === "left" ? finalistY[0] : finalistY[1] };
              paths.push(<path key={`${side}-finalist`} d={connectorPath(semifinal, target, side)} />);
            }
            return paths;
          })}
          <path d={`M ${centerX} ${finalistY[0] + 54} V ${centerY - 62}`} />
          <path d={`M ${centerX} ${finalistY[1] - 54} V ${centerY + 62}`} />
        </svg>

        {regionCount > 0 && effectiveRegionNames.map((region, regionIndex) => {
          const bounds = getRegionBounds(regionIndex);
          if (!bounds) return null;
          const side = regionIndex < regionsPerSide ? "left" : "right";
          return <div
            className={`regionWatermark ${side} ${selectedRegion === String(regionIndex) ? "active" : ""}`}
            key={regionIndex}
            style={{ left: (bounds.minX + bounds.maxX) / 2, top: (bounds.minY + bounds.maxY) / 2 }}
            aria-hidden="true"
          >
            <span>{region}</span>
          </div>;
        })}

        {(["left", "right"] as const).flatMap((side) => Array.from({ length: sideRounds }, (_, roundIndex) => {
          const round = roundIndex + 1;
          const count = size / 2 ** (round + 1);
          const offset = side === "left" ? 0 : count;
          const x = side === "left" ? centerX - (sideRounds - round + 1) * roundGap : centerX + (sideRounds - round + 1) * roundGap;
          return <section className={`canvasRound ${side}`} key={`${side}-${round}`} style={{ left: x - cardWidth / 2 }}>
            <h2>{roundLabel(round)}</h2>
            {Array.from({ length: count }, (_, localMatch) => {
              const match = offset + localMatch;
              const center = matchCenters.get(`${side}-${round}-${match}`) ?? { x, y: centerY };
              return <MatchupCard
                key={match}
                top={center.y - matchupHeight / 2}
                width={cardWidth}
                options={participants(round, match)}
                winnerId={winners[matchKey(round, match)]}
                seedLabel={(item) => displayedSeed(item, size, seedingStyle)}
                editable={editable}
                onWinner={(item) => onWinner(round, match, item)}
              />;
            })}
          </section>;
        }))}

        <div className="finalStage" style={{ left: centerX - cardWidth / 2, top: finalistY[0] - 54 }}>
          <h2>Finalist</h2>
          <FinalistCard editable={editable} seedLabel={(item) => displayedSeed(item, size, seedingStyle)} contestant={finalists[0]} selected={championId === finalists[0]?.id} onClick={() => finalists[0] && onWinner(rounds, 0, finalists[0])} />
        </div>
        <div className="finalStage bottom" style={{ left: centerX - cardWidth / 2, top: finalistY[1] - 54 }}>
          <FinalistCard editable={editable} seedLabel={(item) => displayedSeed(item, size, seedingStyle)} contestant={finalists[1]} selected={championId === finalists[1]?.id} onClick={() => finalists[1] && onWinner(rounds, 0, finalists[1])} />
          <h2>Finalist</h2>
        </div>
        <ChampionCard seedLabel={(item) => displayedSeed(item, size, seedingStyle)} contestant={champion} left={centerX - 170} top={centerY - 82} />
      </div>
    </div>
  </div>;
}

function MatchupCard({ options, winnerId, seedLabel, editable, onWinner, top, width }: {
  options: Array<Contestant | null>; winnerId?: string; seedLabel: (item: Contestant) => number; editable: boolean; onWinner: (item: Contestant) => void; top: number; width: number;
}) {
  return <div className="canvasMatchup" style={{ top, width }}>
    {options.map((item, slot) => item ? <button disabled={!editable} className={`${winnerId === item.id ? "winner" : ""} ${!editable ? "readOnly" : ""}`} key={item.id ?? item.seed} onClick={() => editable && onWinner(item)}>
      <ContestantPhoto contestant={item} />
      <span className="seedBadge">{seedLabel(item)}</span>
      <span className="contestantCopy"><b>{item.shortName || item.name}</b><small>{item.details || (editable ? "Click to advance" : "View contestant")}</small></span>
      <em>{winnerId === item.id ? "✓" : "›"}</em>
    </button> : <div className="canvasTbd" key={slot}><span>?</span><div><b>Winner TBD</b><small>Complete the previous matchup</small></div></div>)}
  </div>;
}

function FinalistCard({ contestant, selected, seedLabel, editable, onClick }: { contestant: Contestant | null; selected: boolean; seedLabel: (item: Contestant) => number; editable: boolean; onClick: () => void }) {
  return contestant ? <button disabled={!editable} className={`finalistCard ${selected ? "winner" : ""} ${!editable ? "readOnly" : ""}`} onClick={() => editable && onClick()}>
    <ContestantPhoto contestant={contestant} />
    <span className="seedBadge">{seedLabel(contestant)}</span>
    <span className="contestantCopy"><b>{contestant.name}</b><small>{contestant.details || "Choose as champion"}</small></span>
    <em>{selected ? "✓" : "›"}</em>
  </button> : <div className="finalistCard canvasTbd"><span>?</span><div><b>Finalist TBD</b><small>Complete the semifinal</small></div></div>;
}

function ChampionCard({ contestant, left, top, seedLabel }: { contestant?: Contestant; left: number; top: number; seedLabel: (item: Contestant) => number }) {
  return <section className={`centerChampion ${contestant ? "ready" : ""}`} style={{ left, top }}>
    <div className="championCrown">★</div>
    {contestant ? <>
      <ContestantPhoto contestant={contestant} large />
      <small>FATBRACKETS CHAMPION</small>
      <h2>{contestant.name}</h2>
      <p>Seed #{seedLabel(contestant)}</p>
    </> : <><div className="emptyChampion">?</div><small>AWAITING A WINNER</small><h2>Your champion</h2><p>Choose the winner of the final.</p></>}
  </section>;
}

function ContestantPhoto({ contestant, large = false }: { contestant: Contestant; large?: boolean }) {
  return <i className={large ? "contestantPhoto large" : "contestantPhoto"} style={{ background: contestant.accentColor }}>
    {contestant.imageUrl ? <img src={contestant.imageUrl} alt={`${contestant.name}`} /> : initials(contestant.name)}
  </i>;
}

function SaveLabel({ state }: { state: SaveState }) {
  return <span className={`saveStatus ${state}`}>{state === "saving" ? "● Saving…" : state === "saved" ? "● Saved" : state === "error" ? "● Save failed" : "● Unsaved changes"}</span>;
}

function AuthModal(props: { email: string; password: string; message: string; mode: "login" | "signup"; onAuth: () => void; onClose: () => void; onEmail: (value: string) => void; onPassword: (value: string) => void; onMode: () => void }) {
  return <><button className="scrim authScrim" aria-label="Close sign in" onClick={props.onClose} /><section className="authModal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
    <button className="authClose" onClick={props.onClose}>×</button><small>FATBRACKETS ACCOUNT</small><h2 id="auth-title">{props.mode === "login" ? "Welcome back" : "Create your account"}</h2><p>Sign in to save brackets and manage them from any device.</p>
    <label>Email<input type="email" value={props.email} onChange={(event) => props.onEmail(event.target.value)} /></label>
    <label>Password<input type="password" value={props.password} onChange={(event) => props.onPassword(event.target.value)} /></label>
    {props.message && <div className="authMessage">{props.message}</div>}
    <button className="authSubmit" onClick={props.onAuth}>{props.mode === "login" ? "Sign in" : "Create account"}</button>
    <button className="authSwitch" onClick={props.onMode}>{props.mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}</button>
  </section></>;
}

function Title({ n, title, text }: { n: string; title: string; text: string }) {
  return <div className="title"><b>{n}</b><div><h2>{title}</h2><p>{text}</p></div></div>;
}
function Method({ icon, title, text, active = false, onClick }: { icon: string; title: string; text: string; active?: boolean; onClick: () => void }) {
  return <button type="button" className={active ? "chosen" : ""} onClick={onClick}><i>{icon}</i><b>{title}</b><small>{text}</small></button>;
}
function PlayModeCard({ title, text, chosen, onClick }: { title: string; text: string; chosen: boolean; onClick: () => void }) {
  return <button type="button" className={chosen ? "chosen" : ""} onClick={onClick}><b>{title}</b><small>{text}</small></button>;
}
function Player({ contestant, onClick }: { contestant: Contestant; onClick?: () => void }) {
  return <button className={`player ${!contestant.name ? "emptyPlayer" : ""}`} onClick={onClick}><span>{contestant.seed}</span><i style={{ background: contestant.name ? contestant.accentColor : "#e8ecf2" }}>{contestant.imageUrl ? <img src={contestant.imageUrl} alt="" /> : initials(contestant.name)}</i><b>{contestant.name || `Add seed ${contestant.seed}`}<small>{contestant.details || (contestant.name ? "No details yet" : "Click to add contestant")}</small></b><em>•••</em></button>;
}
