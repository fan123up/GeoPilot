"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import { getApiBase } from "../utils/apiBase";

export default function SignupPage() {
  const router = useRouter();
  const { signup } = useAuth();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<Array<{ name: string; issuer: string }>>([]);
  const apiBase = getApiBase();

  useEffect(() => {
    async function loadProviders() {
      try {
        const res = await fetch(`${apiBase}/auth/oidc/providers`);
        if (!res.ok) return;
        const data = await res.json();
        setProviders(data);
      } catch {
        // ignore provider fetch errors to keep password signup available
      }
    }
    loadProviders();
  }, [apiBase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signup(email, password, displayName);
      router.push('/map');
    } catch {
      setError("注册失败，请检查输入后重试");
    }
  };

  return (
    <div className="max-w-md mx-auto mt-16 p-4 border border-primary-300 rounded">
      <h1 className="text-xl font-semibold mb-4">注册 GeoPilot</h1>
      {error && <div className="text-danger-600 mb-2">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label>邮箱</label>
          <input
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-primary-300 p-2 rounded"
            required
          />
        </div>
        <div>
          <label>显示名称</label>
          <input
            type="text"
            name="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full border border-primary-300 p-2 rounded"
            required
          />
        </div>
        <div>
          <label>密码</label>
          <input
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-primary-300 p-2 rounded"
            required
          />
        </div>
        <button
          type="submit"
          className="w-full bg-second-primary-600 text-neutral-50 p-2 rounded hover:bg-second-primary-700"
        >
          注册
        </button>
      </form>
      {providers.length > 0 && (
        <div className="mt-6 space-y-2">
          <div className="text-sm text-neutral-700">或使用以下方式继续</div>
          <div className="space-y-2">
            {providers.map((p) => (
              <button
                key={p.name}
                onClick={() => {
                  const redirect = `${window.location.origin}/map`;
                  const url = `${apiBase}/auth/oidc/login?provider=${p.name}&redirect=${encodeURIComponent(
                    redirect
                  )}`;
                  window.location.href = url;
                }}
                className="w-full border border-primary-300 p-2 rounded hover:bg-primary-50"
              >
                使用 {p.name.charAt(0).toUpperCase() + p.name.slice(1)} 注册
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="mt-4 text-sm">
        已有账号？{' '}
        <a href="/login" className="text-second-primary-600 hover:text-second-primary-700">
          登录
        </a>
      </p>
    </div>
  );
}
