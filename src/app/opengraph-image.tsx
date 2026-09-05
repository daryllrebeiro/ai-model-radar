import { ImageResponse } from 'next/og';

export const alt = 'AI Model Radar — Real-time AI Model Price, Release & Arbitrage Intelligence';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '48px 64px',
          background: 'linear-gradient(135deg, #0B0F17 0%, #082F3D 100%)',
          color: '#fff',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: 'linear-gradient(135deg, #06B6D4, #10B981)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 34,
              fontWeight: 800,
            }}
          >
            R
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 1, color: '#67e8f9' }}>
            AI MODEL RADAR
          </div>
        </div>
        <div style={{ fontSize: 58, fontWeight: 800, lineHeight: 1.15, maxWidth: 1000 }}>
          Real-time AI Model Changelog, Price Drops &amp; Arbitrage Engine
        </div>
        <div style={{ fontSize: 30, color: '#94a3b8', marginTop: 20, maxWidth: 980 }}>
          Track every price cut, free-tier release, context upgrade and cross-provider arbitrage in one feed.
        </div>
        <div style={{ fontSize: 22, color: '#34d399', marginTop: 32, fontFamily: 'monospace' }}>
          openrouter.ai · github research labs · huggingface hub
        </div>
      </div>
    ),
    size
  );
}