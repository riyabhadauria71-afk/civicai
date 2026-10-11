import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileImage,
  LocateFixed,
  LogOut,
  MapPin,
  Menu,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { CivicReport } from "@/lib/civicai";
import { formatReportDate, ISSUE_CATEGORIES, statusLabel, statusTone } from "@/lib/civicai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import civicStreet from "@/assets/civicai-street.jpg";

type AuthMode = "sign_in" | "sign_up";
type ProfileUser = { id: string; email: string; name: string };
type ReportWithMedia = CivicReport & { previewUrl: string | null };

const ACCEPTED_MEDIA = "image/jpeg,image/png,image/webp,video/mp4,video/quicktime";
const MEDIA_LIMIT = 25 * 1024 * 1024;

function friendlyError(message: string) {
  if (/invalid login credentials/i.test(message)) return "That email and password do not match.";
  if (/email not confirmed/i.test(message))
    return "Confirm your email from the message we sent, then sign in.";
  if (/already registered/i.test(message))
    return "An account with this email already exists. Sign in instead.";
  return message;
}

function AuthPanel({ onComplete }: { onComplete: (user: ProfileUser) => void }) {
  const [mode, setMode] = useState<AuthMode>("sign_up");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendingConfirmation, setResendingConfirmation] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const saveProfile = useCallback(
    async (userId: string, displayName: string, userEmail: string) => {
      const safeEmail = userEmail || "";
      const safeName = displayName || safeEmail.split("@").at(0) || "Neighbour";
      const { error: profileError } = await supabase
        .from("profiles")
        .upsert({ id: userId, display_name: safeName }, { onConflict: "id" });
      if (profileError) throw profileError;
      onComplete({ id: userId, name: safeName, email: safeEmail });
    },
    [onComplete],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "sign_up") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: name } },
        });
        if (signUpError) throw signUpError;
        if (!data.session || !data.user) {
          setNotice(
            "A confirmation email was requested. Check your inbox, including Spam and Promotions.",
          );
          setMode("sign_in");
          return;
        }
        await saveProfile(data.user.id, name, email);
        return;
      }
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;
      if (data.user) await saveProfile(data.user.id, name, email);
    } catch (caught) {
      setError(
        friendlyError(caught instanceof Error ? caught.message : "We couldn't complete sign-in."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function resendConfirmation() {
    setResendingConfirmation(true);
    setError("");
    setNotice("");
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email,
      });
      if (resendError) throw resendError;
      setNotice("A new confirmation email was requested. Check Spam and Promotions too.");
    } catch (caught) {
      setError(
        friendlyError(
          caught instanceof Error
            ? caught.message
            : "We couldn't resend the confirmation email. Please try again.",
        ),
      );
    } finally {
      setResendingConfirmation(false);
    }
  }

  async function handleGoogle() {
    setBusy(true);
    setError("");
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (oauthError) throw oauthError;
    } catch (caught) {
      setError(
        friendlyError(
          caught instanceof Error ? caught.message : "Google sign-in is unavailable right now.",
        ),
      );
      setBusy(false);
    }
  }

  return (
    <div className="auth-panel" aria-labelledby="auth-title">
      <div className="auth-icon">
        <ShieldCheck aria-hidden="true" />
      </div>
      <p className="eyebrow">YOUR NEIGHBOURHOOD, LOOKED AFTER</p>
      <h2 id="auth-title">{mode === "sign_up" ? "Join your community" : "Welcome back"}</h2>
      <p className="auth-copy">Sign in to send a report and keep track of what happens next.</p>
      <div className="auth-tabs" role="tablist" aria-label="Account options">
        <Button
          type="button"
          role="tab"
          aria-selected={mode === "sign_up"}
          variant={mode === "sign_up" ? "default" : "ghost"}
          onClick={() => {
            setMode("sign_up");
            setError("");
            setNotice("");
          }}
        >
          Create account
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={mode === "sign_in"}
          variant={mode === "sign_in" ? "default" : "ghost"}
          onClick={() => {
            setMode("sign_in");
            setError("");
            setNotice("");
          }}
        >
          Sign in
        </Button>
      </div>
      <form className="auth-form" onSubmit={handleSubmit}>
        {mode === "sign_up" && (
          <label className="field-label">
            Your name
            <Input
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Asha Patel"
              maxLength={80}
            />
          </label>
        )}
        <label className="field-label">
          Email address
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
          />
        </label>
        <label className="field-label">
          Password
          <Input
            type="password"
            autoComplete={mode === "sign_up" ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 6 characters"
            minLength={6}
            required
          />
        </label>
        {error && (
          <p className="form-message form-error" role="alert">
            <CircleAlert aria-hidden="true" />
            {error}
          </p>
        )}
        {notice && (
          <div className="form-message form-notice" role="status">
            <Check aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}
        <Button className="auth-submit" type="submit" disabled={busy}>
          {busy ? "Please wait…" : mode === "sign_up" ? "Create account" : "Sign in"}
          <ChevronRight aria-hidden="true" />
        </Button>
      </form>
      {notice.includes("confirmation email") && (
        <Button
          type="button"
          variant="ghost"
          className="resend-confirmation"
          disabled={resendingConfirmation || !email}
          onClick={() => void resendConfirmation()}
        >
          {resendingConfirmation ? "Resending…" : "Resend confirmation email"}
        </Button>
      )}
      <div className="auth-divider">
        <span>or</span>
      </div>
      <Button
        type="button"
        variant="outline"
        className="google-submit"
        onClick={handleGoogle}
        disabled={busy}
      >
        <span className="google-mark" aria-hidden="true">
          G
        </span>
        Continue with Google
      </Button>
      <p className="auth-privacy">
        Your report and location are visible only to you and the response team.
      </p>
    </div>
  );
}

function MediaUpload({
  file,
  setFile,
}: {
  file: File | null;
  setFile: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [invalid, setInvalid] = useState("");
  const preview = useMemo(
    () => (file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null),
    [file],
  );

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  function acceptFiles(files: FileList | null) {
    const candidate = files?.[0];
    setInvalid("");
    if (!candidate) return;
    if (!candidate.type.startsWith("image/") && !candidate.type.startsWith("video/")) {
      setInvalid("Choose a JPG, PNG, WEBP or short MP4 video.");
      return;
    }
    if (candidate.size > MEDIA_LIMIT) {
      setInvalid("This file is too large. Choose a file under 25 MB.");
      return;
    }
    setFile(candidate);
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_MEDIA}
        capture="environment"
        className="sr-only"
        aria-label="Choose a photo or video"
        onChange={(event) => acceptFiles(event.target.files)}
      />
      {file ? (
        <div className="chosen-media">
          {preview ? (
            <img src={preview} alt="Selected civic issue" />
          ) : (
            <div className="video-file">
              <FileImage aria-hidden="true" />
              <span>{file.name}</span>
            </div>
          )}
          <div className="chosen-media-meta">
            <span className="chosen-media-name">{file.name}</span>
            <span>{(file.size / 1024 / 1024).toFixed(1)} MB</span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="remove-media"
            aria-label="Remove selected file"
            onClick={() => {
              setFile(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          className={`upload-zone ${dragging ? "is-dragging" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            acceptFiles(event.dataTransfer.files);
          }}
          aria-label="Add a photo or video of the issue"
        >
          <span className="upload-icon">
            <Camera aria-hidden="true" />
          </span>
          <span className="upload-copy">
            <strong>Take a photo or choose a file</strong>
            <span>Photos or a short video · max 25 MB</span>
          </span>
          <span className="upload-action">
            <Upload aria-hidden="true" /> Add media
          </span>
        </button>
      )}
      {invalid && (
        <p className="field-error" role="alert">
          {invalid}
        </p>
      )}
    </div>
  );
}

function ReportCard({ report }: { report: ReportWithMedia }) {
  return (
    <article className="report-row">
      <div className="report-thumb">
        {report.previewUrl && report.media_mime.startsWith("image/") ? (
          <img src={report.previewUrl} alt="Your report" loading="lazy" />
        ) : (
          <FileImage aria-hidden="true" />
        )}
      </div>
      <div className="report-main">
        <div className="report-title-line">
          <h3>{report.category ?? "Civic issue report"}</h3>
          <span className={`status-chip ${statusTone(report.status)}`}>
            <span className="status-dot" />
            {statusLabel(report.status)}
          </span>
        </div>
        <p>{report.description || "Photo report"}</p>
        <div className="report-metadata">
          <span>
            <Clock3 aria-hidden="true" />
            {formatReportDate(report.created_at)}
          </span>
          {report.latitude !== null && (
            <span>
              <MapPin aria-hidden="true" />
              Location attached
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="report-chevron" aria-hidden="true" />
    </article>
  );
}

export function CivicDashboard() {
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [reports, setReports] = useState<ReportWithMedia[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(
    null,
  );
  const [locationMessage, setLocationMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reportFilter, setReportFilter] = useState("ALL");
  const [menuOpen, setMenuOpen] = useState(false);
  const reportsRef = useRef<HTMLDivElement>(null);

  const loadReports = useCallback(async (userId: string) => {
    const { data, error: reportsError } = await supabase
      .from("reports")
      .select("*")
      .eq("reporter_id", userId)
      .order("created_at", { ascending: false });
    if (reportsError) {
      setError("We couldn't load your reports. Please refresh and try again.");
      return;
    }
    const fetched = (data ?? []) as CivicReport[];
    const withUrls = await Promise.all(
      fetched.map(async (report) => {
        const { data: signedData } = await supabase.storage
          .from("civic-media")
          .createSignedUrl(report.media_path, 60 * 60);
        return { ...report, previewUrl: signedData?.signedUrl ?? null };
      }),
    );
    setReports(withUrls);
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        const sessionUser = data.session?.user;
        if (!alive) return;
        if (sessionUser) {
          const email = sessionUser.email ?? "";
          const name = String(
            sessionUser.user_metadata?.["display_name"] ?? email.split("@").at(0) ?? "Neighbour",
          );
          setUser({ id: sessionUser.id, email, name });
          await loadReports(sessionUser.id);
        }
        if (alive) setAuthReady(true);
      })
      .catch(() => {
        if (alive) setAuthReady(true);
      });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user;
      if (!sessionUser) {
        setUser(null);
        setReports([]);
        setAuthReady(true);
        return;
      }
      const email = sessionUser.email ?? "";
      const name = String(
        sessionUser.user_metadata?.["display_name"] ?? email.split("@").at(0) ?? "Neighbour",
      );
      setUser({ id: sessionUser.id, email, name });
      setAuthReady(true);
      queueMicrotask(() => {
        void loadReports(sessionUser.id);
      });
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, [loadReports]);

  function useMyLocation() {
    setLocationMessage("");
    if (!navigator.geolocation) {
      setLocationMessage(
        "Location isn't available on this device. You can send your photo without it.",
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setCoordinates({ latitude: coords.latitude, longitude: coords.longitude });
        setLocationMessage("Approximate location added to your report.");
      },
      () =>
        setLocationMessage(
          "Location permission wasn't available. You can send your photo without it.",
        ),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 },
    );
  }

  async function submitReport() {
    setMessage("");
    setError("");
    if (!user) {
      setError("Sign in first to submit your report.");
      return;
    }
    if (!file) {
      setError("Add a photo or short video before sending your report.");
      return;
    }
    setBusy(true);
    const extension = file.name.includes(".")
      ? file.name.split(".").pop()?.toLowerCase()
      : "upload";
    const mediaPath = `${user.id}/${crypto.randomUUID()}.${extension || "upload"}`;
    try {
      const { error: uploadError } = await supabase.storage
        .from("civic-media")
        .upload(mediaPath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data: inserted, error: insertError } = await supabase
        .from("reports")
        .insert({
          reporter_id: user.id,
          media_path: mediaPath,
          media_mime: file.type,
          category: category || null,
          description: description.trim() || null,
          latitude: coordinates?.latitude ?? null,
          longitude: coordinates?.longitude ?? null,
        })
        .select("*")
        .single();
      if (insertError) throw insertError;
      if (inserted) {
        const { data: signedData } = await supabase.storage
          .from("civic-media")
          .createSignedUrl(mediaPath, 60 * 60);
        setReports((previous) => [
          { ...(inserted as CivicReport), previewUrl: signedData?.signedUrl ?? null },
          ...previous,
        ]);
      }
      setFile(null);
      setCategory("");
      setDescription("");
      setCoordinates(null);
      setLocationMessage("");
      setMessage("Your report is in. The response team can now review it.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? friendlyError(caught.message)
          : "We couldn't send your report. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setMenuOpen(false);
  }

  const visibleReports = reports.filter((report) => {
    if (reportFilter === "ACTIVE")
      return report.status !== "RESOLVED" && report.status !== "REJECTED";
    if (reportFilter === "RESOLVED") return report.status === "RESOLVED";
    return true;
  });
  const waitingReports = reports.filter(
    (report) => report.status === "REPORTED" || report.status === "AI_ANALYZED",
  ).length;
  const activeReports = reports.filter(
    (report) => report.status === "ASSIGNED" || report.status === "IN_PROGRESS",
  ).length;
  const resolvedReports = reports.filter((report) => report.status === "RESOLVED").length;

  return (
    <div className="civic-app">
      <header className="site-header">
        <div className="header-inner">
          <a className="brand-lockup" href="/" aria-label="CivicAI home">
            <span className="brand-mark">
              <MapPin aria-hidden="true" />
            </span>
            <span className="brand-name">
              civic<span>ai</span>
            </span>
          </a>
          <nav className={`main-nav ${menuOpen ? "nav-open" : ""}`} aria-label="Main navigation">
            <a className="nav-link nav-active" href="#report">
              Report an issue
            </a>
            <a className="nav-link" href="#my-reports" onClick={() => setMenuOpen(false)}>
              My reports{reports.length > 0 && <span className="nav-count">{reports.length}</span>}
            </a>
          </nav>
          <div className="header-account">
            {user ? (
              <div className="account-menu-wrap">
                <Button
                  type="button"
                  variant="ghost"
                  className="account-button"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen(!menuOpen)}
                >
                  <span className="account-avatar">{user.name.slice(0, 1).toUpperCase()}</span>
                  <span className="account-name">{user.name}</span>
                  <ChevronDown aria-hidden="true" />
                </Button>
                {menuOpen && (
                  <div className="account-popover">
                    <span className="account-email">{user.email}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      className="signout-button"
                      onClick={signOut}
                    >
                      <LogOut aria-hidden="true" />
                      Sign out
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <a href="#sign-in" className="header-sign-in">
                Sign in <ArrowUpRight aria-hidden="true" />
              </a>
            )}
            <Button
              className="mobile-menu"
              variant="ghost"
              size="icon"
              aria-label="Toggle navigation"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Menu aria-hidden="true" />
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="intro-band">
          <div className="intro-copy">
            <p className="eyebrow">
              <span className="eyebrow-dot" />A BETTER STREET STARTS WITH YOU
            </p>
            <h1>
              See something?
              <br />
              <span>Send it our way.</span>
            </h1>
            <p className="intro-description">
              A quick photo helps your local team spot and respond to issues around your
              neighbourhood.
            </p>
          </div>
          <div
            className="intro-image"
            role="img"
            aria-label="A municipal worker inspecting a pothole in a neighbourhood street"
            style={{ backgroundImage: `url(${civicStreet})` }}
          >
            <div className="image-caption">
              <span className="caption-dot" />
              BETTER STREETS, TOGETHER
            </div>
          </div>
        </section>

        <section className="page-content" id="report">
          <div className="workspace-grid">
            <div className="report-column">
              <div className="section-heading">
                <span className="section-kicker">01 / REPORT</span>
                <h2>Tell us what needs fixing</h2>
                <p>Start with a photo. The rest is optional.</p>
              </div>
              <div className="report-form">
                <div className="form-step">
                  <span className="step-number">1</span>
                  <div className="step-content">
                    <label className="field-label">
                      Add a photo or short video <span className="required-mark">Required</span>
                    </label>
                    <p className="field-hint">
                      A clear image helps the response team understand the issue.
                    </p>
                    <MediaUpload file={file} setFile={setFile} />
                  </div>
                </div>
                <div className="form-step">
                  <span className="step-number">2</span>
                  <div className="step-content">
                    <label className="field-label" htmlFor="issue-category">
                      What kind of issue is it? <span className="optional-mark">Optional</span>
                    </label>
                    <p className="field-hint">
                      Not sure? Leave this blank and the response team can review it.
                    </p>
                    <div className="select-wrap">
                      <select
                        id="issue-category"
                        value={category}
                        onChange={(event) => setCategory(event.target.value)}
                      >
                        <option value="">Choose a category (optional)</option>
                        {ISSUE_CATEGORIES.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                      <ChevronDown aria-hidden="true" />
                    </div>
                  </div>
                </div>
                <div className="form-step">
                  <span className="step-number">3</span>
                  <div className="step-content">
                    <label className="field-label" htmlFor="report-description">
                      Anything else to add? <span className="optional-mark">Optional</span>
                    </label>
                    <Textarea
                      id="report-description"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="A nearby landmark or a few helpful details…"
                      maxLength={500}
                      rows={3}
                    />
                    <div className="textarea-counter">{description.length} / 500</div>
                  </div>
                </div>
                <div className="form-step location-step">
                  <span className="step-number">4</span>
                  <div className="step-content">
                    <div className="location-heading">
                      <div>
                        <span className="field-label">
                          Add your location <span className="optional-mark">Optional</span>
                        </span>
                        <p className="field-hint">
                          Location stays private to you and your response team.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="location-button"
                        onClick={useMyLocation}
                      >
                        <LocateFixed aria-hidden="true" />
                        {coordinates ? "Location added" : "Use my location"}
                      </Button>
                    </div>
                    {locationMessage && (
                      <p
                        className={`location-message ${coordinates ? "location-success" : ""}`}
                        role="status"
                      >
                        {coordinates && <Check aria-hidden="true" />}
                        {locationMessage}
                      </p>
                    )}
                  </div>
                </div>
                {!authReady && (
                  <div className="auth-loading">
                    <span className="loading-mark" />
                    Checking your account…
                  </div>
                )}
                {authReady && !user && (
                  <div id="sign-in">
                    <AuthPanel
                      onComplete={(signedInUser) => {
                        setUser(signedInUser);
                        void loadReports(signedInUser.id);
                      }}
                    />
                  </div>
                )}
                {error && (
                  <p className="form-message form-error submit-feedback" role="alert">
                    <CircleAlert aria-hidden="true" />
                    {error}
                  </p>
                )}
                {message && (
                  <p className="form-message form-success submit-feedback" role="status">
                    <Check aria-hidden="true" />
                    {message}
                  </p>
                )}
                {user && (
                  <div className="submit-bar">
                    <p>
                      <ShieldCheck aria-hidden="true" />
                      Only you and your local response team can see this report.
                    </p>
                    <Button
                      type="button"
                      className="submit-report"
                      disabled={busy || !file}
                      onClick={() => void submitReport()}
                    >
                      {busy ? "Sending report…" : "Send report"}
                      <ArrowUpRight aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </div>
              <p className="ai-note">
                <Sparkles aria-hidden="true" />
                <span>
                  <strong>Thoughtful review, not guesswork.</strong> Reports are reviewed by people.
                  AI image analysis will be added after model training is complete.
                </span>
              </p>
            </div>

            <aside className="reports-column" id="my-reports" ref={reportsRef}>
              <div className="reports-heading">
                <div>
                  <span className="section-kicker">02 / YOUR UPDATES</span>
                  <h2>Your reports</h2>
                </div>
                <a className="all-reports-link" href="#my-reports">
                  {reports.length > 0 && "View all"}
                  <ArrowUpRight aria-hidden="true" />
                </a>
              </div>
              {user ? (
                <>
                  <div className="report-stats" aria-label="Your report summary">
                    <div className="report-stat">
                      <span>Awaiting review</span>
                      <strong>{waitingReports.toString().padStart(2, "0")}</strong>
                      <span className="stat-indicator">
                        <Clock3 aria-hidden="true" />
                        Waiting
                      </span>
                    </div>
                    <div className="report-stat">
                      <span>Being addressed</span>
                      <strong>{activeReports.toString().padStart(2, "0")}</strong>
                      <span className="stat-indicator stat-live">
                        <ArrowUpRight aria-hidden="true" />
                        In progress
                      </span>
                    </div>
                    <div className="report-stat">
                      <span>Resolved</span>
                      <strong>{resolvedReports.toString().padStart(2, "0")}</strong>
                      <span className="stat-indicator">
                        <Check aria-hidden="true" />
                        Completed
                      </span>
                    </div>
                  </div>
                  <div className="report-list-header">
                    <span>RECENT ACTIVITY</span>
                    <div className="filter-tabs" role="group" aria-label="Filter reports">
                      <Button
                        type="button"
                        size="sm"
                        variant={reportFilter === "ALL" ? "secondary" : "ghost"}
                        onClick={() => setReportFilter("ALL")}
                      >
                        All
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={reportFilter === "ACTIVE" ? "secondary" : "ghost"}
                        onClick={() => setReportFilter("ACTIVE")}
                      >
                        Active
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={reportFilter === "RESOLVED" ? "secondary" : "ghost"}
                        onClick={() => setReportFilter("RESOLVED")}
                      >
                        Resolved
                      </Button>
                    </div>
                  </div>
                  {visibleReports.length > 0 ? (
                    <div className="report-list">
                      {visibleReports.slice(0, 5).map((report) => (
                        <ReportCard key={report.id} report={report} />
                      ))}
                      {visibleReports.length > 5 && (
                        <Button
                          type="button"
                          variant="ghost"
                          className="load-more-reports"
                          onClick={() => reportsRef.current?.scrollIntoView({ behavior: "smooth" })}
                        >
                          Showing 5 of {visibleReports.length} reports
                          <ArrowDownRight aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="empty-reports">
                      <span className="empty-icon">
                        <FileImage aria-hidden="true" />
                      </span>
                      <h3>
                        {reports.length === 0
                          ? "Your street, your signal."
                          : "Nothing in this view."}
                      </h3>
                      <p>
                        {reports.length === 0
                          ? "Your reports and their progress will appear here once you send one."
                          : "Try another filter to see your reports."}
                      </p>
                      <a href="#report">
                        {reports.length === 0 ? "Send your first report" : "See all reports"}
                        <ChevronRight aria-hidden="true" />
                      </a>
                    </div>
                  )}
                  <div className="status-key">
                    <span>
                      <i className="status-key-dot status-key-reported" />
                      Received
                    </span>
                    <span>
                      <i className="status-key-dot status-key-progress" />
                      In progress
                    </span>
                    <span>
                      <i className="status-key-dot status-key-resolved" />
                      Resolved
                    </span>
                  </div>
                </>
              ) : (
                <div className="empty-reports signed-out-empty">
                  <span className="empty-icon">
                    <MapPin aria-hidden="true" />
                  </span>
                  <h3>Your neighbourhood, together.</h3>
                  <p>Sign in to send a report and receive progress updates from your local team.</p>
                  <a href="#sign-in">
                    Sign in or create an account
                    <ChevronRight aria-hidden="true" />
                  </a>
                </div>
              )}
              <div className="response-note">
                <span className="response-note-icon">
                  <Clock3 aria-hidden="true" />
                </span>
                <p>
                  <strong>Every report gets seen.</strong>
                  <br />A real response team reviews each issue and updates your report as they
                  work.
                </p>
              </div>
              <div className="updates-legend">
                <span className="legend-icon">
                  <ShieldCheck aria-hidden="true" />
                </span>
                <p>
                  <strong>Built on trust.</strong> Your photos and precise location are private to
                  your response team.
                </p>
              </div>
            </aside>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <a className="footer-brand" href="/">
          civic<span>ai</span>
        </a>
        <span>Making neighbourhoods a little better, together.</span>
        <a className="footer-link" href="mailto:hello@civicai.example">
          Get in touch <ArrowUpRight aria-hidden="true" />
        </a>
      </footer>
    </div>
  );
}
