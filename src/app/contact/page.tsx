'use client';

import React, { useState } from 'react';
import { MessageSquare, Send, CheckCircle2, AlertCircle } from 'lucide-react';

export default function ContactPage() {
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState('support');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setErrorMsg('');

    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, category, message }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit request');
      }

      setStatus('success');
      setEmail('');
      setMessage('');
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Something went wrong');
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
      <div className="border-b border-gray-800 pb-6 space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/50 text-cyan-400 text-xs font-mono">
          <MessageSquare className="w-3.5 h-3.5" />
          <span>HELP &amp; DEVELOPER SUPPORT</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Contact Support &amp; Engineering
        </h1>
        <p className="text-sm text-gray-400">
          Have questions regarding API integrations, custom enterprise quotas, model provider requests, or privacy inquiries?
        </p>
      </div>

      <div className="p-8 rounded-2xl border border-gray-800 bg-[#111827]/80">
        {status === 'success' ? (
          <div className="text-center py-10 space-y-4">
            <div className="w-12 h-12 rounded-full bg-emerald-950/80 border border-emerald-800 flex items-center justify-center mx-auto text-emerald-400">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-white">Message Received</h2>
            <p className="text-xs text-gray-400 max-w-md mx-auto">
              Thank you for reaching out. Our engineering team responds to all inquiries within 1 business day.
            </p>
            <button
              onClick={() => setStatus('idle')}
              className="mt-4 px-4 py-2 rounded-lg bg-gray-900 border border-gray-700 hover:border-cyan-500 text-xs font-mono text-cyan-400 transition-colors"
            >
              Send Another Message
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {status === 'error' && (
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/50 text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-mono text-gray-300 font-semibold">Your Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="developer@acme.com"
                className="w-full px-3.5 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-mono text-gray-300 font-semibold">Inquiry Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500 font-mono"
              >
                <option value="support">API &amp; Technical Support</option>
                <option value="billing">Billing &amp; Subscription Questions</option>
                <option value="model_request">Request New Model / Provider</option>
                <option value="privacy">Privacy &amp; Data Erasure (GDPR)</option>
                <option value="security">Security Vulnerability Disclosure</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-mono text-gray-300 font-semibold">Message</label>
              <textarea
                required
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe your question, request, or issue in detail..."
                className="w-full px-3.5 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={status === 'loading'}
              className="w-full py-2.5 px-4 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold uppercase tracking-wider transition-colors flex items-center justify-center gap-2"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{status === 'loading' ? 'Sending...' : 'Submit Message'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
