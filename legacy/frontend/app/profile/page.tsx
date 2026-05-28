'use client';

import { useEffect, useState } from 'react';
import { LogOut, UploadCloud } from 'lucide-react';

import { BrandCard } from '@/components/BrandCard';
import { TransitionLink } from '@/components/TransitionLink';
import { api, DocumentChangeRequest, UploadItem, UserProfile } from '@/lib/api';
import { clearAuthState, loadAuthState, saveAuthState } from '@/lib/auth';

const PROFILE_UPLOAD_SESSION_ID = 'profile-library';

export default function ProfilePage() {
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [documents, setDocuments] = useState<UploadItem[]>([]);
  const [changes, setChanges] = useState<DocumentChangeRequest[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const auth = loadAuthState();
    if (!auth.token) {
      setLoading(false);
      return;
    }
    setToken(auth.token);
  }, []);

  useEffect(() => {
    if (!token) {
      setProfile(null);
      setDocuments([]);
      setChanges([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([api.getMe(token), api.listMyDocuments(token), api.listMyDocumentChangeRequests(token)])
      .then(([me, docs, reqs]) => {
        if (cancelled) return;
        setProfile(me);
        setDocuments(docs);
        setChanges(reqs);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.message || '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSendCode() {
    try {
      setBusy(true);
      setError('');
      const res = await api.sendCode(email, password);
      setMessage(res.message || '验证码已发送，请填写后完成注册。');
    } catch (err: any) {
      setError(err.message || '发送验证码失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    try {
      setBusy(true);
      setError('');
      const res = await api.verifyCode(email, code);
      saveAuthState(res.access_token, res.user);
      setToken(res.access_token);
      setMessage('注册成功并已自动登录。');
    } catch (err: any) {
      setError(err.message || '验证失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleRegisterFlow() {
    if (!code.trim()) {
      await handleSendCode();
      return;
    }
    await handleVerify();
  }

  async function handleLogin() {
    try {
      setBusy(true);
      setError('');
      const res = await api.login(email, password);
      saveAuthState(res.access_token, res.user);
      setToken(res.access_token);
      setMessage('登录成功。');
    } catch (err: any) {
      setError(err.message || '登录失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    if (!token) return;
    await api.logout(token).catch(() => undefined);
    clearAuthState();
    setToken(null);
    setProfile(null);
    setDocuments([]);
    setChanges([]);
    setMessage('已退出登录。');
  }

  async function handleUpload(file: File) {
    if (!token) return;
    try {
      setBusy(true);
      setError('');
      const row = await api.uploadFile(PROFILE_UPLOAD_SESSION_ID, file, token);
      setDocuments((prev) => [row, ...prev]);
      setMessage('资料已上传到个人中心。');
    } catch (err: any) {
      setError(err.message || '上传失败');
    } finally {
      setBusy(false);
    }
  }

  async function submitQuickChange(documentId: string) {
    if (!token) return;
    try {
      await api.createDocumentChangeRequest(documentId, token, {
        reason: '用户中心快速发起变更申请',
      });
      const reqs = await api.listMyDocumentChangeRequests(token);
      setChanges(reqs);
    } catch (err: any) {
      setError(err.message || '提交变更失败');
    }
  }

  return (
    <main className='min-h-screen p-4 md:p-6'>
      <div className='mx-auto max-w-6xl space-y-4'>
        <div className='grid gap-4 lg:grid-cols-[280px_1fr]'>
          <aside className='panel vt-persistent p-3'>
            <BrandCard />
            <div className='mt-3 grid gap-2'>
              <TransitionLink href='/' className='btn-outline justify-start px-3 py-2 text-xs' direction='back'>
                返回工作台
              </TransitionLink>
              {profile?.role === 'admin' ? (
                <TransitionLink href='/admin' className='btn-outline justify-start px-3 py-2 text-xs' direction='forward'>
                  管理员控制台
                </TransitionLink>
              ) : null}
            </div>
          </aside>

          <section className='space-y-4'>
            <div className='panel p-4'>
              <div className='flex items-center justify-between gap-3'>
                <div>
                  <p className='text-xs font-semibold uppercase tracking-[0.18em] text-crimson-700'>账户中心</p>
                  <h1 className='mt-1 text-2xl font-semibold text-zinc-900'>/profile</h1>
                </div>
                {token ? (
                  <button className='btn-outline px-3 py-2 text-xs' onClick={handleLogout}>
                    <LogOut className='mr-1 h-4 w-4' /> 退出登录
                  </button>
                ) : null}
              </div>
              {message ? <p className='mt-3 text-sm text-crimson-700'>{message}</p> : null}
              {error ? <p className='mt-2 text-sm text-red-600'>{error}</p> : null}
            </div>

            {loading ? <div className='panel p-4 text-sm text-zinc-600'>加载中...</div> : null}

            {!loading && !token ? (
              <div className='panel p-4'>
                <p className='text-sm text-zinc-600'>首页不再承载登录/注册表单，所有账户动作统一迁到这里。</p>
                <div className='mt-4 grid gap-3 md:grid-cols-2'>
                  <input className='input text-sm' placeholder='邮箱' value={email} onChange={(event) => setEmail(event.target.value)} />
                  <input
                    className='input text-sm'
                    type='password'
                    placeholder='密码'
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <input
                    className='input text-sm md:col-span-2'
                    placeholder='验证码（注册时填写）'
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </div>
                <div className='mt-4 flex flex-wrap gap-2'>
                  <button className='btn-primary px-4 py-2 text-sm' onClick={handleRegisterFlow} disabled={busy}>
                    注册
                  </button>
                  <button className='btn-outline px-4 py-2 text-sm' onClick={handleLogin} disabled={busy}>
                    登录
                  </button>
                </div>
              </div>
            ) : null}

            {!loading && token ? (
              <>
                <div className='panel p-4'>
                  <h2 className='text-sm font-semibold text-crimson-800'>个人资料</h2>
                  {profile ? (
                    <div className='mt-3 grid gap-2 text-sm text-zinc-700 md:grid-cols-2'>
                      <p>邮箱：{profile.email}</p>
                      <p>角色：{profile.role}</p>
                      <p>验证状态：{profile.is_verified ? '已验证' : '未验证'}</p>
                      <p>账户状态：{profile.is_active ? '启用' : '禁用'}</p>
                      <p>超管：{profile.is_super_admin ? '是' : '否'}</p>
                      <p>注册时间：{new Date(profile.created_at).toLocaleString()}</p>
                    </div>
                  ) : null}
                </div>

                <div className='panel p-4'>
                  <div className='flex items-center justify-between gap-3'>
                    <h2 className='text-sm font-semibold text-crimson-800'>个人上传资料</h2>
                    <label className='btn-primary cursor-pointer px-3 py-2 text-xs'>
                      <UploadCloud className='mr-1 h-4 w-4' /> 上传文档
                      <input
                        type='file'
                        accept='image/*,.pdf,.doc,.docx,.ppt,.pptx,.txt,.md'
                        className='hidden'
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) handleUpload(file);
                          event.currentTarget.value = '';
                        }}
                      />
                    </label>
                  </div>
                  <div className='mt-3 space-y-2'>
                    {documents.length === 0 ? <p className='text-xs text-zinc-500'>暂无文档</p> : null}
                    {documents.map((doc) => (
                      <div key={doc.id} className='rounded-2xl border border-crimson-100 bg-white p-3 text-xs'>
                        <p className='font-semibold text-zinc-800'>{doc.original_filename}</p>
                        <p className='mt-1 text-zinc-600'>状态：{doc.status}</p>
                        <button className='btn-outline mt-2 px-2 py-1 text-xs' onClick={() => submitQuickChange(doc.id)}>
                          发起变更申请
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className='panel p-4'>
                  <h2 className='text-sm font-semibold text-crimson-800'>我的变更审核进度</h2>
                  <div className='mt-3 space-y-2'>
                    {changes.length === 0 ? <p className='text-xs text-zinc-500'>暂无变更申请</p> : null}
                    {changes.map((row) => (
                      <div key={row.id} className='rounded-2xl border border-crimson-100 bg-white p-3 text-xs'>
                        <p>请求ID: {row.id}</p>
                        <p>文档ID: {row.document_id}</p>
                        <p>状态: {row.status}</p>
                        <p>理由: {row.reason ?? '-'}</p>
                        <p>审核意见: {row.review_note ?? '-'}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
