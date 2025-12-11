import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs"
import { dark } from "@clerk/themes"
import { Plus_Jakarta_Sans, Figtree, Michroma } from "next/font/google";
import GlobalToaster from "@/components/GlobalToaster";


const jakarta = Plus_Jakarta_Sans({ 
  subsets: ["latin"],
  weight: ['500', '600', '700', '800'], // Grosores para títulos
  variable: '--font-jakarta' // Asigna una variable CSS
});

const figtree = Figtree({
  subsets: ["latin"],
  weight: ['400', '500', '600'], // Grosores para cuerpo de texto
  variable: '--font-figtree' // Asigna otra variable CSS
});

const michroma = Michroma({
  subsets: ["latin"],
  weight: ['400'], 
  variable: '--font-michroma' // Asignamos su propia variable CSS
});



export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),

  title: {
    default: 'Eventify',
    template: '%s | Eventify',
  },

  description: 'Events, Simplified.',

  openGraph: {
    title: 'Eventify',
    description: 'Events, Simplified.',
    url: '/',
    siteName: 'Eventify',
  },

  twitter: {
    card: 'summary_large_image',
    title: 'Eventify',
    description: 'Events, Simplified.',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#000000',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
    appearance={{
    baseTheme: dark,
    variables: {
      colorBackground: 'black',
    },
    cssLayerName: 'clerk',
    elements: {
      userButtonPopoverMain: 'clk-popover-main' ,
      userButtonPopoverActionButton: 'clk-popover-action',
      userButtonPopoverActionButtonIcon: 'clk-popover-action-icon',
      userButtonPopoverCustomItemButton: 'clk-popover-action',
      userButtonPopoverCustomItemButtonIconBox: 'clk-popover-action-icon',
      userButtonPopoverDivider: 'clk-popover-divider',
      userButtonPopoverFooter: 'clk-popover-footer',
      loaderIcon: 'clk-loader',
      scrollBox: '!bg-black !border-t !border-t-[rgba(255,255,255,0.07)] md:!border-l md:!border-l-[rgba(255,255,255,0.07)]',
      cardBox: 'clk-card-box',
      actionCard: '!bg-black',
      menuList: '!bg-black',
      formFieldInput: '!bg-black',
    }
  }}
    >
    <html
     lang="en"
      className={`${jakarta.variable} ${figtree.variable} ${michroma.variable}`}

        >
      <body className="bg-black scroll-smooth">
        {children}
        <GlobalToaster />
       
      </body>
    </html>
    </ClerkProvider>
  );
}
