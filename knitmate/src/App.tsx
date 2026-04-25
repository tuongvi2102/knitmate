import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import Navbar from './components/layout/Navbar';
import Footer from './components/layout/Footer';
import Home from './pages/Home';
import Convert from './pages/Convert';
import Design from './pages/Design';
import Patterns from './pages/Patterns';

function RootLayout() {
  return (
    <>
      <Navbar />
      <Outlet />
      <Footer />
    </>
  );
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'convert', element: <Convert /> },
      { path: 'design', element: <Design /> },
      { path: 'patterns', element: <Patterns /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
