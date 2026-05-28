'use client';

import { useEffect, useMemo, useState } from 'react';

import { api, DocumentChangeRequest, UploadItem, User } from '@/lib/api';
import { loadAuthState } from '@/lib/auth';
import { TransitionLink } from '@/components/TransitionLink';

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [documents, setDocuments] = useState<UploadItem[]>([]);
  const [changes, setChanges] = useState<DocumentChangeRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const canAccess = useMemo(() => me?.role === 'admin', [me]);

  async function refreshAll(authToken: string, currentStatusFilter: string) {
    const profile = await api.getMe(authToken);
    setMe(profile);
    if (profile.role !== 'admin') {
      setUsers([]);
      setDocuments([]);
      setChanges([]);
      return;
    }

    const [userRows, docRows, changeRows] = await Promise.all([
      api.listAdminUsers(authToken),
      api.listAdminDocuments(authToken, {
        status: currentStatusFilter || undefined,
      }),
      api.listAdminDocumentChangeRequests(authToken),
    ]);
    setUsers(userRows);
    setDocuments(docRows);
    setChanges(changeRows);
  }

  useEffect(() => {
    const auth = loadAuthState();
    if (!auth.token) {
      setLoading(false);
      return;
    }
    setToken(auth.token);
    setLoading(true);
    refreshAll(auth.token, statusFilter)
      .catch((err: any) => setError(err.message || '加载失败'))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  async function updateRole(userId: string, role: 'user' | 'admin') {
    if (!token) return;
    try {
      await api.updateAdminUserRole(userId, role, token);
      const userRows = await api.listAdminUsers(token);
      setUsers(userRows);
    } catch (err: any) {
      setError(err.message || '角色更新失败');
    }
  }

  async function toggleUserStatus(target: User) {
    if (!token) return;
    try {
      await api.updateAdminUserStatus(target.id, !(target.is_active ?? true), token);
      const userRows = await api.listAdminUsers(token);
      setUsers(userRows);
    } catch (err: any) {
      setError(err.message || '状态更新失败');
    }
  }

  async function softDeleteDoc(documentId: string) {
    if (!token) return;
    try {
      await api.softDeleteAdminDocument(documentId, token);
      const docRows = await api.listAdminDocuments(token, { status: statusFilter || undefined });
      setDocuments(docRows);
    } catch (err: any) {
      setError(err.message || '删除失败');
    }
  }

  async function reviewChange(changeId: number, action: 'approve' | 'reject') {
    if (!token) return;
    try {
      if (action === 'approve') {
        await api.approveAdminDocumentChange(changeId, token, '管理员通过');
      } else {
        await api.rejectAdminDocumentChange(changeId, token, '管理员驳回');
      }
      const changeRows = await api.listAdminDocumentChangeRequests(token);
      setChanges(changeRows);
    } catch (err: any) {
      setError(err.message || '审核失败');
    }
  }

  if (loading) {
    return <main className='min-h-screen p-6 text-sm text-zinc-600'>加载中...</main>;
  }

  if (!token) {
    return (
      <main className='min-h-screen p-6 text-sm text-zinc-700'>
        未登录，无法访问管理控制台。<TransitionLink href='/' className='ml-2 text-crimson-700 underline' direction='back'>返回工作台</TransitionLink>
      </main>
    );
  }

  if (!canAccess) {
    return (
      <main className='min-h-screen p-6 text-sm text-zinc-700'>
        当前账号不是管理员。<TransitionLink href='/' className='ml-2 text-crimson-700 underline' direction='back'>返回工作台</TransitionLink>
      </main>
    );
  }

  return (
    <main className='min-h-screen p-4 md:p-6'>
      <div className='mx-auto max-w-6xl space-y-4'>
        <div className='panel vt-persistent p-4'>
          <div className='flex items-center justify-between'>
            <h1 className='text-lg font-bold text-crimson-800'>管理员控制台</h1>
            <TransitionLink href='/' className='btn-outline px-3 py-1.5 text-xs' direction='back'>
              返回工作台
            </TransitionLink>
          </div>
          {error ? <p className='mt-2 text-xs text-red-600'>{error}</p> : null}
        </div>

        <div className='panel p-4'>
          <h2 className='text-sm font-semibold text-crimson-800'>用户管理</h2>
          <div className='mt-3 space-y-2'>
            {users.map((row) => (
              <div key={row.id} className='rounded-xl border border-crimson-100 bg-white p-3 text-xs'>
                <p className='font-semibold text-zinc-800'>
                  {row.email} ({row.role})
                </p>
                <p className='mt-1 text-zinc-600'>
                  状态: {row.is_active ? '启用' : '禁用'} | 超管: {row.is_super_admin ? '是' : '否'}
                </p>
                <div className='mt-2 flex flex-wrap gap-2'>
                  <button className='btn-outline px-2 py-1 text-xs' onClick={() => updateRole(row.id, 'user')}>
                    设为用户
                  </button>
                  <button className='btn-outline px-2 py-1 text-xs' onClick={() => updateRole(row.id, 'admin')}>
                    设为管理员
                  </button>
                  <button className='btn-outline px-2 py-1 text-xs' onClick={() => toggleUserStatus(row)}>
                    {row.is_active ? '禁用' : '启用'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className='panel p-4'>
          <div className='flex items-center justify-between gap-2'>
            <h2 className='text-sm font-semibold text-crimson-800'>文档管理</h2>
            <select className='input w-[180px] text-xs' value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value=''>全部状态</option>
              <option value='draft'>draft</option>
              <option value='pending_review'>pending_review</option>
              <option value='approved'>approved</option>
              <option value='rejected'>rejected</option>
            </select>
          </div>
          <div className='mt-3 space-y-2'>
            {documents.length === 0 ? <p className='text-xs text-zinc-500'>暂无文档</p> : null}
            {documents.map((row) => (
              <div key={row.id} className='rounded-xl border border-crimson-100 bg-white p-3 text-xs'>
                <p className='font-semibold text-zinc-800'>{row.original_filename}</p>
                <p className='mt-1 text-zinc-600'>
                  owner: {row.owner_email ?? row.owner_id} | status: {row.status}
                </p>
                <button className='btn-outline mt-2 px-2 py-1 text-xs' onClick={() => softDeleteDoc(row.id)}>
                  软删除
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className='panel p-4'>
          <h2 className='text-sm font-semibold text-crimson-800'>文档变更审核队列</h2>
          <div className='mt-3 space-y-2'>
            {changes.length === 0 ? <p className='text-xs text-zinc-500'>暂无变更请求</p> : null}
            {changes.map((row) => (
              <div key={row.id} className='rounded-xl border border-crimson-100 bg-white p-3 text-xs'>
                <p>请求ID: {row.id}</p>
                <p>文档ID: {row.document_id}</p>
                <p>请求人: {row.requester_email ?? row.requester_id ?? '-'}</p>
                <p>状态: {row.status}</p>
                <p>理由: {row.reason ?? '-'}</p>
                {row.status === 'pending' ? (
                  <div className='mt-2 flex gap-2'>
                    <button className='btn-primary px-2 py-1 text-xs' onClick={() => reviewChange(row.id, 'approve')}>
                      通过
                    </button>
                    <button className='btn-outline px-2 py-1 text-xs' onClick={() => reviewChange(row.id, 'reject')}>
                      驳回
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
