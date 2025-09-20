export default function LandingPage() {
  return (
    <main className="min-h-screen">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-steel-dark via-steel to-black opacity-60" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 text-center">
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight">
            Welcome to SAIL Logistics Platform
          </h1>
          <p className="mt-4 text-lg text-gray-300">
            Smart, Scalable, Data-Driven Rail & Yard Management
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <a
              href="/signin"
              className="rounded-lg bg-brand-green px-6 py-3 font-medium text-black hover:opacity-90"
            >
              Login
            </a>
            <a
              href="/dashboard"
              className="rounded-lg border border-gray-600 px-6 py-3 font-medium text-gray-100 hover:bg-white/10"
            >
              Demo
            </a>
          </div>

          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            <div className="rounded-xl bg-white/5 p-6 border border-white/10">
              <p className="text-sm text-gray-400">Total Active Rakes</p>
              <p className="text-3xl font-bold">18</p>
            </div>
            <div className="rounded-xl bg-white/5 p-6 border border-white/10">
              <p className="text-sm text-gray-400">Wagons in Operation</p>
              <p className="text-3xl font-bold">520</p>
            </div>
            <div className="rounded-xl bg-white/5 p-6 border border-white/10">
              <p className="text-sm text-gray-400">Carbon Saved Today</p>
              <p className="text-3xl font-bold text-brand-green">3.2t</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
