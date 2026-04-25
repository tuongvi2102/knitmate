export default function Footer() {
  return (
    <footer className="bg-white text-warm py-10 w-full border-t border-bluegray">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-warm mr-2">
            <i className="fa-solid fa-palette text-sm" />
          </div>
          <span className="font-heading font-bold text-warm">KnitMate</span>
        </div>
        <p className="text-sm text-accent">&copy; 2026 KnitMate. All rights reserved.</p>
        <div className="flex gap-6 text-sm">
          <a href="#" className="text-accent hover:text-warm transition-colors">Privacy</a>
          <a href="#" className="text-accent hover:text-warm transition-colors">Terms</a>
          <a href="#" className="text-accent hover:text-warm transition-colors">Contact</a>
        </div>
      </div>
    </footer>
  );
}
