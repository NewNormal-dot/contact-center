import { useState, type FormEvent, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, User, Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';
import apiClient from '../../lib/api-client';

export default function Login() {
  const navigate = useNavigate();
  const { user, login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const [isForgotPassword, setIsForgotPassword] = useState(false);

  useEffect(() => {
    if (user) {
      if (user.role === 'superadmin') navigate('/superadmin');
      else if (user.role === 'admin') navigate('/admin');
      else navigate('/csr');
    }
  }, [user, navigate]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      setErrorMsg('Нэвтрэх нэр болон нууц үгээ оруулна уу.');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      await login(email, password);
    } catch (err: any) {
      setErrorMsg(
        err.response?.data?.error ||
          err.message ||
          'Нэвтрэлт амжилтгүй. Дахин оролдоно уу.'
      );
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex flex-col font-sans text-gray-100 overflow-hidden">
      {/* Background Image */}
      <div
        className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: 'url("/bg.png")' }}
      >
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
      </div>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="w-full max-w-md"
        >
          <div className="relative bg-gray-900/80 dark:bg-black/60 backdrop-blur-xl p-6 sm:p-8 rounded-2xl shadow-2xl border border-white/5 dark:border-white/10 overflow-hidden rgb-border">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 dark:from-blue-500/10 to-purple-500/10 dark:to-purple-500/10 pointer-events-none"></div>

            <div className="text-center mb-6 sm:mb-10 relative z-10">
              <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight uppercase text-white drop-shadow-sm">
                Workforce
              </h1>
              <p className="text-blue-400 font-bold mt-1 tracking-widest uppercase text-[10px]">
                Contact Center System
              </p>
            </div>

            <div className="relative">
              {!isForgotPassword ? (
                <form onSubmit={handleLogin} className="space-y-6">
                  {errorMsg && (
                    <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200 text-sm text-center">
                      {errorMsg}
                    </div>
                  )}

                  {/* Email Input */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-400 dark:text-gray-300 uppercase tracking-wider ml-1">
                      И-мэйл хаяг
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                        <User size={18} />
                      </div>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full pl-11 pr-4 py-3.5 bg-gray-800/50 dark:bg-black/50 border border-white/5 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-white transition-all placeholder-gray-500 font-medium"
                        placeholder="example@mobicom.mn"
                        required
                      />
                    </div>
                  </div>

                  {/* Password Input */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-400 dark:text-gray-300 uppercase tracking-wider ml-1">
                      Нууц үг
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                        <Lock size={18} />
                      </div>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full pl-11 pr-12 py-3.5 bg-gray-800/50 dark:bg-black/50 border border-white/5 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-white transition-all placeholder-gray-500 font-medium"
                        placeholder="••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-blue-500 transition-colors"
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  <div className="flex justify-between items-center px-1">
                    <button
                      type="button"
                      onClick={() => setIsForgotPassword(true)}
                      className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      Нууц үг мартсан?
                    </button>
                  </div>

                  {/* Login Button */}
                  <button
                    type="submit"
                    disabled={loading}
                    className={`w-full py-3.5 rounded-xl font-bold tracking-wide transition-all duration-300 ${
                      loading
                        ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                        : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700 shadow-lg hover:shadow-blue-500/25 transform hover:-translate-y-0.5'
                    }`}
                  >
                    {loading ? 'Уншиж байна...' : 'Нэвтрэх'}
                  </button>
                </form>
              ) : (
                <div className="text-center py-6">
                  <h3 className="text-xl font-bold mb-4">Нууц үг сэргээх</h3>
                  <p className="text-gray-400 text-sm mb-6">
                    Бүртгэлтэй и-мэйл хаягаа оруулан нууц үг сэргээх холбоос
                    хүлээн авна уу.
                  </p>

                  <div className="space-y-4">
                    <input
                      type="email"
                      className="w-full px-4 py-3 bg-black/50 border border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 transition-all"
                      placeholder="И-мэйл хаяг"
                    />

                    <button
                      type="button"
                      className="w-full py-3 bg-blue-600 rounded-xl font-bold"
                      onClick={() =>
                        alert('Сэргээх и-мэйл илгээгдлээ. (Azure Communication Services demo)')
                      }
                    >
                      Илгээх
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsForgotPassword(false)}
                      className="block w-full text-center text-gray-400 hover:text-white text-sm font-bold"
                    >
                      Буцах
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-8 pt-6 border-t border-white/5 flex flex-col items-center gap-2">
                <p className="text-xs text-gray-500">Та нэвтрэн систем ашиглаж болно.</p>
              </div>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}