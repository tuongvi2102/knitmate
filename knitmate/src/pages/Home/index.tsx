import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="w-full min-h-screen bg-white text-gray-800 overflow-x-hidden">
      {/* Hero */}
      <section
        className="pt-32 pb-20 lg:pt-40 lg:pb-28 w-full relative overflow-hidden"
        style={{
          background: `
            radial-gradient(circle at top right, rgba(237,187,164,0.15), transparent 40%),
            radial-gradient(circle at bottom left, rgba(196,146,112,0.08), transparent 40%)`,
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-12">
            <div className="w-full lg:w-1/2 text-center lg:text-left">
              <div className="inline-flex items-center px-4 py-2 rounded-full bg-light text-warm font-medium text-sm mb-6 border border-primary">
                <span className="flex h-2 w-2 rounded-full bg-warm mr-2" />
                New: AI Pattern Generator available now!
              </div>
              <h1 className="text-5xl lg:text-6xl font-extrabold text-warm leading-tight mb-6">
                Make your own pattern
              </h1>
              <p className="text-lg text-accent mb-8 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                The all-in-one platform for creators. Convert images seamlessly, design stunning colorworks, and access thousands of free patterns to elevate your projects.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
                <Link
                  to="/convert"
                  className="w-full sm:w-auto bg-[#C6634E] hover:bg-[#b3573f] text-white px-8 py-4 rounded-full font-semibold text-lg transition-all transform hover:-translate-y-1 shadow-xl shadow-[#C6634E]/30 flex items-center justify-center"
                >
                  Start Creating Free
                  <i className="fa-solid fa-arrow-right ml-2" />
                </Link>
                <button className="w-full sm:w-auto bg-white hover:bg-light text-warm border-2 border-bluegray px-8 py-4 rounded-full font-semibold text-lg transition-all flex items-center justify-center">
                  <i className="fa-solid fa-play text-secondary mr-2" />
                  Watch Demo
                </button>
              </div>
              <div className="mt-10 flex items-center justify-center lg:justify-start space-x-4">
                <div className="flex -space-x-3">
                  {[
                    'https://storage.googleapis.com/uxpilot-auth.appspot.com/2cc26b0b77-7f4e40f0fdb0e6b26ce9.png',
                    'https://storage.googleapis.com/uxpilot-auth.appspot.com/409c34df90-8ed41d2aead17e02bcd6.png',
                    'https://storage.googleapis.com/uxpilot-auth.appspot.com/1d0c48ffe4-aee5607194026ff1dd35.png',
                  ].map((src, i) => (
                    <img key={i} src={src} alt="User" className="w-10 h-10 rounded-full border-2 border-white object-cover" />
                  ))}
                  <div className="w-10 h-10 rounded-full border-2 border-white bg-light flex items-center justify-center text-xs font-bold text-warm">+2k</div>
                </div>
                <p className="text-sm text-accent font-medium">Trusted by 2,000+ knitters worldwide</p>
              </div>
            </div>

            <div className="w-full lg:w-1/2 relative">
              <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 to-secondary/20 rounded-3xl transform rotate-3 scale-105 blur-lg" />
              <div className="relative bg-white p-4 rounded-3xl shadow-2xl border border-bluegray">
                <img src="/images/homepage.jpg" alt="Knitting pattern example" className="w-full h-auto rounded-2xl object-cover" />
                <div className="absolute -left-8 top-1/4 bg-white p-4 rounded-xl shadow-xl border border-bluegray animate-bounce">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-full bg-light flex items-center justify-center text-warm">
                      <i className="fa-solid fa-check" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-warm">Conversion Done</p>
                      <p className="text-xs text-accent">0.2 seconds</p>
                    </div>
                  </div>
                </div>
                <div
                  className="absolute -right-6 bottom-1/4 bg-white p-3 rounded-xl shadow-xl border border-bluegray animate-bounce"
                  style={{ animationDelay: '1s' }}
                >
                  <div className="flex gap-2">
                    <div className="w-6 h-6 rounded-full bg-[#EDBBA4]" />
                    <div className="w-6 h-6 rounded-full bg-[#C49270]" />
                    <div className="w-6 h-6 rounded-full bg-[#EBDBD4]" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 bg-light w-full">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-warm mb-4">
              Three powerful tools.<br />One seamless workflow.
            </h2>
            <p className="text-accent text-lg">Everything you need to bring your visual ideas to life.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: 'fa-image', title: 'Convert Image', desc: 'Instantly convert images into a knitting pattern with customizable grid sizes and color palettes.', to: '/convert', cta: 'Try Converter' },
              { icon: 'fa-fill-drip', title: 'Design Colorwork', desc: 'Extract palettes from images, generate complementary colors, and test combinations for your next project.', to: '/design', cta: 'Explore Colors' },
              { icon: 'fa-shapes', title: 'Free Patterns', desc: 'Access our library of 5,000+ seamless patterns. Customize colors, scale, and download.', to: '/patterns', cta: 'Browse Patterns' },
            ].map(f => (
              <div key={f.to} className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow border border-bluegray group">
                <div className="w-16 h-16 rounded-2xl bg-light flex items-center justify-center text-warm text-2xl mb-6 group-hover:scale-110 transition-transform">
                  <i className={`fa-solid ${f.icon}`} />
                </div>
                <h3 className="text-2xl font-bold text-warm mb-3">{f.title}</h3>
                <p className="text-accent mb-6 leading-relaxed">{f.desc}</p>
                <Link to={f.to} className="text-secondary font-semibold flex items-center hover:text-warm transition-colors">
                  {f.cta} <i className="fa-solid fa-arrow-right ml-2 text-sm" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sample Works */}
      <section id="patterns" className="py-24 bg-white w-full">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-warm mb-4">Sample Works &amp; Inspiration</h2>
            <p className="text-accent text-lg">Explore what's possible with our pattern generator and color tools.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { src: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/df56be2800-c6ecc39e13c80418cbbf.png', title: 'Memphis Geometric', colors: ['#EDBBA4','#C49270','#EBDBD4','#CF9B71'] },
              { src: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/d870d9cb2e-366a55e9347df0adf444.png', title: 'Minimalist Line Art', colors: ['#1A1A1A','#FAFAFA'] },
              { src: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/14001b066b-0bda924897cbc1d2599f.png', title: 'Fluid Gradient', colors: ['#FF3366','#9933FF','#00CCFF'] },
            ].map(item => (
              <div key={item.title} className="bg-white rounded-xl overflow-hidden shadow-md group cursor-pointer border border-bluegray">
                <div className="h-48 overflow-hidden relative">
                  <img src={item.src} alt={item.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button className="bg-white text-warm px-4 py-2 rounded-full font-medium text-sm hover:bg-primary transition-colors">Edit Pattern</button>
                  </div>
                </div>
                <div className="p-4 border-t border-bluegray">
                  <h4 className="font-bold text-warm">{item.title}</h4>
                  <div className="flex gap-1 mt-2">
                    {item.colors.map(c => (
                      <div key={c} className="w-4 h-4 rounded-full border border-bluegray" style={{ background: c }} />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="text-center mt-12">
            <Link to="/patterns" className="inline-block bg-white border-2 border-bluegray text-warm hover:border-primary hover:bg-light px-8 py-3 rounded-full font-semibold transition-all">
              View All Patterns
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-primary w-full relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Ready to start knitting?</h2>
          <p className="text-white/80 text-lg mb-8 max-w-2xl mx-auto">Join thousands of knitters using KnitMate to bring their creative visions to life.</p>
          <Link
            to="/convert"
            className="inline-block bg-white hover:bg-light text-secondary px-10 py-4 rounded-full font-semibold text-lg transition-all transform hover:-translate-y-1 shadow-xl shadow-[#EDBBA4]/40"
          >
            Start Creating Free <i className="fa-solid fa-arrow-right ml-2" />
          </Link>
        </div>
      </section>
    </div>
  );
}
