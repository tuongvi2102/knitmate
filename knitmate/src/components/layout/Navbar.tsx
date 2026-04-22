import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const links = [
  { to: '/', label: 'Home' },
  { to: '/convert', label: 'Convert Image' },
  { to: '/design', label: 'Design Colorwork' },
  { to: '/patterns', label: 'Free Patterns' },
];

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  return (
    <nav className="w-full bg-white/90 backdrop-blur-md fixed top-0 z-50 border-b border-bluegray">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20">
          <Link to="/" className="flex-shrink-0 flex items-center">
            <img src="/images/logo_only3.png" alt="KnitMate logo" className="h-14 w-auto mr-2" />
            <span className="font-heading font-bold text-2xl text-warm">Design colorwork</span>
          </Link>

          <div className="hidden md:flex space-x-8 items-center">
            {links.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className={`font-medium transition-colors ${
                  pathname === to
                    ? 'text-warm font-semibold border-b-2 border-warm pb-0.5'
                    : 'text-warm hover:text-secondary'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>

          <div className="flex items-center space-x-4">
            <a href="#" className="hidden lg:block text-accent hover:text-warm font-medium">Log in</a>
            <button className="bg-[#C6634E] hover:bg-[#b3573f] text-white px-6 py-2.5 rounded-full font-medium transition-all transform hover:scale-105 shadow-lg shadow-[#C6634E]/30">
              Get Started
            </button>
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="md:hidden text-warm hover:text-secondary text-2xl"
            >
              <i className="fa-solid fa-bars" />
            </button>
          </div>
        </div>
      </div>

      {menuOpen && (
        <div className="md:hidden bg-white border-t border-bluegray px-4 py-4 space-y-1">
          {links.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              onClick={() => setMenuOpen(false)}
              className={`block font-medium py-2 px-2 rounded-lg transition-colors ${
                pathname === to
                  ? 'text-warm font-semibold bg-light'
                  : 'text-warm hover:text-secondary hover:bg-light'
              }`}
            >
              {label}
            </Link>
          ))}
          <div className="pt-3 border-t border-bluegray flex items-center gap-3">
            <a href="#" className="text-accent hover:text-warm font-medium text-sm">Log in</a>
            <button className="bg-[#C6634E] hover:bg-[#b3573f] text-white px-5 py-2 rounded-full font-medium text-sm">
              Get Started
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
