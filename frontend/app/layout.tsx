import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Orydl",
  description:
    "You give it one goal. Orydl calls ten places at once, haggles each down in their own language, and brings back the best deal, while you do something else.",
};

const themeScript = `
(function(){
  try{
    var t = localStorage.getItem('orydl-theme');
    document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
  }catch(e){ document.documentElement.setAttribute('data-theme','dark'); }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${plexMono.variable} ${plexSans.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
