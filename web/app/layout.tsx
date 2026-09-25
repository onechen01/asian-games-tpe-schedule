import './globals.css';
import BackToTop from './BackToTop';
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-Hant"><head><title>台灣亞運賽程</title></head><body>{children}<BackToTop/></body></html>;}
