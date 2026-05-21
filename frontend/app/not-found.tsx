import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="panel max-w-md p-8 text-center">
        <h1 className="text-2xl font-semibold text-crimson-800">页面不存在</h1>
        <p className="mt-2 text-sm text-muted">您访问的页面已被移动或不存在。</p>
        <Link href="/" className="btn-primary mt-4 inline-flex">
          返回首页
        </Link>
      </div>
    </div>
  );
}
