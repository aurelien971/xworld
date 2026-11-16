/** Shown on a deployment that has no database yet: what is missing, and the one thing to do. */
export function Setup() {
  return (
    <main className="mx-auto max-w-md px-6 pt-24">
      <h1 className="font-medium">Factory</h1>
      <p className="mt-4 text-base">No database is connected yet.</p>
      <p className="mt-1 text-ink-2">In Vercel, open this project, then Storage, Create Database, Neon. Connect it to this project and redeploy. Then copy this Mac&rsquo;s posts up with the cloud sync.</p>
    </main>
  );
}
