import type { Account, ProjectRole, PublicInvitation } from "@takeboard/contracts";
import {
  createContext,
  type FormEvent,
  Fragment,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { authApi, setApiCsrfToken } from "./api";

const AccountCenter = lazy(() => import("./account-center"));

export type CenterContext = {
  projectKey?: string | undefined;
  projectTitle?: string | undefined;
  projectRole?: ProjectRole | undefined;
};
type AuthContextValue = {
  user: Account | null;
  enabled: boolean;
  local: boolean;
  accountsConfigured: boolean;
  openAccount: (context?: CenterContext) => void;
  refreshUser: (user: Account) => void;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  enabled: false,
  local: false,
  accountsConfigured: false,
  openAccount: () => undefined,
  refreshUser: () => undefined,
});

export function useAuth() {
  return useContext(AuthContext);
}

function AuthMark() {
  return (
    <div className="auth-brand">
      <span className="brand-mark">T</span>
      <div>
        <strong>TakeBoard</strong>
        <span>PRIVATE FILMMAKING WORKSPACE</span>
      </div>
    </div>
  );
}

function RememberLogin({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="auth-remember">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        保持登录<small>仅在自己的设备上使用；最长 30 天，连续 7 天未使用需重新登录。</small>
      </span>
    </label>
  );
}

function AuthScreen({
  configured,
  onAuthenticated,
  onLocal,
}: {
  configured: boolean;
  onAuthenticated: (user: Account, csrfToken: string) => void;
  onLocal?: () => void;
}) {
  const invitationToken = new URLSearchParams(window.location.search).get("invite");
  const [screen, setScreen] = useState<"login" | "recovery">("login");
  const [invitation, setInvitation] = useState<PublicInvitation | null>(null);
  const [invitationState, setInvitationState] = useState<"loading" | "ready" | "invalid">(
    invitationToken ? "loading" : "invalid",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!configured || !invitationToken) return;
    void authApi
      .invitation(invitationToken)
      .then((result) => {
        setInvitation(result.invitation);
        setInvitationState("ready");
      })
      .catch(() => {
        setInvitationState("invalid");
        setError("邀请无效或已过期，请联系管理员重新邀请。");
      });
  }, [configured, invitationToken]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!configured && password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = configured
        ? await authApi.login(email, password, remember)
        : await authApi.bootstrap({ name, email, password, remember });
      onAuthenticated(result.user, result.csrfToken);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法登录 TakeBoard");
    } finally {
      setBusy(false);
    }
  }

  async function acceptInvitation(event: FormEvent) {
    event.preventDefault();
    if (!invitationToken || password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.acceptInvitation(invitationToken, password, remember);
      window.history.replaceState({}, "", window.location.pathname);
      onAuthenticated(result.user, result.csrfToken);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法接受邀请");
    } finally {
      setBusy(false);
    }
  }

  if (configured && invitationToken && invitationState !== "invalid") {
    return (
      <main className="auth-shell">
        <div className="auth-atmosphere" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <section className="auth-card" aria-labelledby="auth-title">
          <AuthMark />
          <div className="auth-card-copy">
            <span className="auth-eyebrow">PRIVATE INVITATION</span>
            <h1 id="auth-title">加入 TakeBoard 工作室</h1>
            <p>
              {invitationState === "loading"
                ? "正在安全验证这份邀请…"
                : `${invitation?.name ?? "你"}，请为 ${invitation?.email ?? ""} 设置密码。`}
            </p>
          </div>
          {invitationState === "ready" ? (
            <form className="auth-form" onSubmit={acceptInvitation}>
              <label>
                <span>设置密码</span>
                <input
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={256}
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label>
                <span>确认密码</span>
                <input
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={256}
                  required
                  type="password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              <small>
                有效期至 {invitation ? new Date(invitation.expiresAt).toLocaleString("zh-CN") : ""}
                ，仅可使用一次。
              </small>
              <RememberLogin checked={remember} onChange={setRemember} />
              {error ? (
                <p className="auth-error" role="alert">
                  {error}
                </p>
              ) : null}
              <button className="auth-primary" disabled={busy} type="submit">
                {busy ? "正在加入…" : "加入工作室"}
              </button>
            </form>
          ) : (
            <div className="auth-loading">
              <span />
            </div>
          )}
        </section>
      </main>
    );
  }

  if (configured && screen === "recovery") {
    return (
      <RecoveryScreen
        onBack={() => {
          setScreen("login");
          setError(null);
          setSuccess(null);
        }}
        onRecovered={() => {
          setScreen("login");
          setError(null);
          setSuccess("密码已重设。请使用新密码登录。");
        }}
      />
    );
  }

  return (
    <main className="auth-shell">
      <div className="auth-atmosphere" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <section className="auth-card" aria-labelledby="auth-title">
        <AuthMark />
        <div className="auth-card-copy">
          <span className="auth-eyebrow">{configured ? "WELCOME BACK" : "FIRST RUN"}</span>
          <h1 id="auth-title">{configured ? "回到你的创作空间" : "创建 TakeBoard 账号"}</h1>
          <p>
            {configured
              ? "项目、素材与生成任务会按照你的权限安全呈现。"
              : onLocal
                ? "账号用于权限管理与设备配对。此设备已有项目仍可在未登录时使用；登录后新建的项目受账号权限保护。"
                : "创建首位管理员。现有本地项目将自动归属于这个账号，文件位置保持不变。"}
          </p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {!configured ? (
            <label>
              <span>你的名字</span>
              <input
                autoComplete="name"
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：Duan"
                required
                value={name}
              />
            </label>
          ) : null}
          <label>
            <span>邮箱</span>
            <input
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            <span>{configured ? "密码" : "管理员密码"}</span>
            <input
              autoComplete={configured ? "current-password" : "new-password"}
              maxLength={256}
              minLength={12}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={configured ? "输入密码" : "至少 12 个字符，推荐使用长口令"}
              required
              type="password"
              value={password}
            />
          </label>
          {!configured ? (
            <label>
              <span>再次输入密码</span>
              <input
                autoComplete="new-password"
                maxLength={256}
                minLength={12}
                onChange={(event) => setConfirmation(event.target.value)}
                required
                type="password"
                value={confirmation}
              />
            </label>
          ) : null}
          <RememberLogin checked={remember} onChange={setRemember} />
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="auth-success" role="status">
              {success}
            </p>
          ) : null}
          <button className="auth-primary" disabled={busy} type="submit">
            {busy ? "正在验证…" : configured ? "进入 TakeBoard" : "创建账号"}
          </button>
          {onLocal ? (
            <button className="auth-text-action" type="button" disabled={busy} onClick={onLocal}>
              继续使用此设备
            </button>
          ) : null}
          {configured ? (
            <button
              className="auth-text-action"
              type="button"
              onClick={() => setScreen("recovery")}
            >
              使用恢复码重设密码
            </button>
          ) : null}
        </form>
        <footer>
          <span>
            <i /> 服务端会话
          </span>
          <span>HttpOnly · SameSite</span>
        </footer>
      </section>
    </main>
  );
}

function RecoveryScreen({ onBack, onRecovered }: { onBack: () => void; onRecovered: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="auth-shell">
      <div className="auth-atmosphere" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <section className="auth-card" aria-labelledby="recovery-title">
        <AuthMark />
        <div className="auth-card-copy">
          <span className="auth-eyebrow">ACCOUNT RECOVERY</span>
          <h1 id="recovery-title">使用离线恢复码</h1>
          <p>恢复码仅可使用一次；成功后其他设备将退出。</p>
        </div>
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (password !== confirmation) return setError("两次输入的新密码不一致");
            setBusy(true);
            setError(null);
            void authApi
              .recover(email, code, password)
              .then(onRecovered)
              .catch((cause) => setError(cause instanceof Error ? cause.message : "无法恢复账号"))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            <span>账号邮箱</span>
            <input
              autoComplete="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            <span>恢复码</span>
            <input
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="TB-XXXX-XXXX-XXXX-XXXX"
            />
          </label>
          <label>
            <span>新密码</span>
            <input
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            <span>确认新密码</span>
            <input
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              type="password"
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="auth-primary" disabled={busy} type="submit">
            {busy ? "正在重设…" : "重设密码"}
          </button>
          <button className="auth-text-action" type="button" onClick={onBack}>
            返回登录
          </button>
        </form>
      </section>
    </main>
  );
}

export function ChangePassword({
  user,
  onChanged,
}: {
  user: Account;
  onChanged: (user: Account) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmation) return setError("两次输入的新密码不一致");
    setBusy(true);
    setError(null);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      const next = { ...user, mustChangePassword: false };
      onChanged(next);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法修改密码");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="account-form" onSubmit={submit}>
      <label>
        <span>当前密码</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </label>
      <label>
        <span>新密码</span>
        <input
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={256}
          required
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
      </label>
      <label>
        <span>确认新密码</span>
        <input
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={256}
          required
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </label>
      <small>修改后会自动退出其他设备，当前设备继续保持登录。</small>
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="auth-success" role="status">
          密码已更新，其他会话已撤销。
        </p>
      ) : null}
      <button className="auth-primary" disabled={busy} type="submit">
        {busy ? "正在更新…" : "更新密码"}
      </button>
    </form>
  );
}

export function AccountButton({
  projectKey,
  projectTitle,
  projectRole,
  compact = false,
}: CenterContext & { compact?: boolean }) {
  const auth = useAuth();
  if (!auth.enabled) return null;
  if (!auth.user)
    return (
      <button
        className={`account-button ${compact ? "compact" : ""}`}
        aria-label="登录"
        type="button"
        onClick={() => auth.openAccount()}
        title="登录以访问账号项目与已配对设备"
      >
        <span aria-hidden="true">↗</span>
        {compact ? null : <b>登录</b>}
      </button>
    );
  return (
    <button
      className={`account-button ${compact ? "compact" : ""}`}
      type="button"
      onClick={() => auth.openAccount({ projectKey, projectTitle, projectRole })}
      title="账号与权限"
    >
      <span>{auth.user.name.slice(0, 1).toUpperCase()}</span>
      {compact ? null : (
        <>
          <b>{auth.user.name}</b>
          <small>
            {auth.user.instanceRole === "admin"
              ? projectRole
                ? "ADMIN ACCESS"
                : "ADMIN"
              : projectRole
                ? projectRole.toUpperCase()
                : "MEMBER"}
          </small>
        </>
      )}
    </button>
  );
}

function LoginDialog({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="auth-login-dialog"
      aria-label="账号登录"
      onCancel={(event) => {
        event.preventDefault();
        onClose?.();
      }}
    >
      {onClose ? (
        <button
          className="auth-dialog-close auth-text-action"
          type="button"
          aria-label="关闭登录"
          onClick={onClose}
        >
          ×
        </button>
      ) : null}
      {children}
    </dialog>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [configured, setConfigured] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [local, setLocal] = useState(false);
  const [localAvailable, setLocalAvailable] = useState(false);
  const [identity, setIdentity] = useState<string | null>(null);
  const [user, setUser] = useState<Account | null>(null);
  const [center, setCenter] = useState<CenterContext | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef(false);
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    const generation = ++loadGeneration.current;
    try {
      const result = await authApi.status();
      if (generation !== loadGeneration.current) return;
      setApiCsrfToken(result.csrfToken);
      setConfigured(result.configured);
      setEnabled(result.enabled);
      setUser(result.user);
      setLocal(result.access === "local");
      setLocalAvailable(result.localAvailable === true);
      if (result.user || result.access === "local" || !result.enabled) {
        setIdentity(result.user?.id ?? "local");
      }
      setStatus("ready");
      setError(null);
    } catch (cause) {
      if (generation !== loadGeneration.current) return;
      setError(cause instanceof Error ? cause.message : "无法连接 TakeBoard 服务");
      setStatus("error");
    } finally {
      if (generation === loadGeneration.current) loading.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const expired = () => {
      setLoginOpen(true);
      setCenter(null);
      void load();
    };
    const offline = () => {
      setError("连接暂时中断，当前页面已保留。恢复后请确认任务状态，不要重复提交生成。");
    };
    window.addEventListener("takeboard:auth-required", expired);
    window.addEventListener("takeboard:connection-lost", offline);
    return () => {
      window.removeEventListener("takeboard:auth-required", expired);
      window.removeEventListener("takeboard:connection-lost", offline);
    };
  }, [load]);
  useEffect(() => {
    if (!error) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [error, load]);

  async function continueLocal() {
    try {
      await authApi.local();
      loadGeneration.current += 1;
      loading.current = false;
      setLoginOpen(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法打开此设备");
    }
  }
  function authenticated(nextUser: Account, token: string) {
    loadGeneration.current += 1;
    loading.current = false;
    setApiCsrfToken(token);
    setConfigured(true);
    setUser(nextUser);
    setIdentity(nextUser.id);
    setLocal(false);
    setLoginOpen(false);
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      enabled,
      local,
      accountsConfigured: configured,
      openAccount: (context = {}) => (user ? setCenter(context) : setLoginOpen(true)),
      refreshUser: setUser,
    }),
    [enabled, local, user, configured],
  );
  const login = (
    <AuthScreen
      configured={configured}
      onAuthenticated={authenticated}
      {...(localAvailable
        ? { onLocal: () => (local ? setLoginOpen(false) : void continueLocal()) }
        : {})}
    />
  );

  if (status === "loading")
    return (
      <main className="auth-loading">
        <AuthMark />
        <span>正在连接 TakeBoard…</span>
      </main>
    );
  if (!identity && status === "error")
    return (
      <main className="auth-loading">
        <AuthMark />
        <p className="auth-error">{error}</p>
        <code>{window.location.origin}</code>
        <p>确认启动器显示的地址与这里一致。SSH 连接需要保持运行。</p>
        <button className="auth-primary" type="button" onClick={() => void load()}>
          重新连接
        </button>
      </main>
    );
  if (!identity && enabled && !user && !local) return login;
  if (enabled && user?.mustChangePassword)
    return (
      <main className="auth-shell">
        <section className="auth-card password-required">
          <AuthMark />
          <div className="auth-card-copy">
            <h1>先更换初始密码</h1>
            <p>更换密码后，才会进入账号项目。</p>
          </div>
          <ChangePassword user={user} onChanged={setUser} />
        </section>
      </main>
    );

  return (
    <AuthContext.Provider value={value}>
      <Fragment key={identity}>{children}</Fragment>
      {error ? (
        <div className="auth-card connection-notice" role="status">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>
            检查连接
          </button>
        </div>
      ) : null}
      {(loginOpen || (enabled && !user && !local)) && status !== "error" ? (
        <LoginDialog {...(local || user ? { onClose: () => setLoginOpen(false) } : {})}>
          {login}
        </LoginDialog>
      ) : null}
      {center && user ? (
        <Suspense
          fallback={
            <div className="auth-card connection-notice" role="status">
              正在打开账号设置…
            </div>
          }
        >
          <AccountCenter
            user={user}
            context={center}
            onClose={() => setCenter(null)}
            onUser={setUser}
            onLogout={() =>
              void authApi
                .logout()
                .then(async () => {
                  loadGeneration.current += 1;
                  loading.current = false;
                  setApiCsrfToken(null);
                  setUser(null);
                  setIdentity(null);
                  setLocal(false);
                  setCenter(null);
                  setLoginOpen(false);
                  await load();
                })
                .catch((cause) =>
                  setError(cause instanceof Error ? cause.message : "退出失败，请重试"),
                )
            }
          />
        </Suspense>
      ) : null}
    </AuthContext.Provider>
  );
}
