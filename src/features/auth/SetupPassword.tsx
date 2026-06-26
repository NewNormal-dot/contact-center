import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { motion } from 'motion/react';
import apiClient from '../../lib/api-client';

export default function SetupPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get('token') || '', [searchParams]);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!token) {
      setError('Нууц үг тохируулах холбоос буруу байна. Админаас дахин link илгээхийг хүснэ үү.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Шинэ нууц үг хоорондоо таарахгүй байна.');
      return;
    }

    if (newPassword.length < 8) {
      setError('Нууц үг хамгийн багадаа 8 тэмдэгт байх ёстой.');
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post('/auth/setup-password', { token, newPassword });
      setMessage(response.data?.message || 'Нууц үг амжилттай тохирлоо.');
      window.setTimeout(() => navigate('/'), 1200);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Нууц үг тохируулахад алдаа гарлаа.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex flex-col font-sans text-gray-100 overflow-hidden">
      <div
        className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: 'url("/bg.png")' }}
      >
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      </div>

      <main className="relative z-10 flex-1 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="w-full max-w-md"
        >
          <div className="relative bg-gray-900/80 dark:bg-black/60 backdrop-blur-xl p-6 sm:p-8 rounded-2xl shadow-2xl border border-white/5 dark:border-white/10 overflow-hidden rgb-border">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 dark:from-blue-500/10 to-purple-500/10 dark:to-purple-500/10 pointer-events-none" />

            <div className="text-center mb-6 sm:mb-8 relative z-10">
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight uppercase text-white drop-shadow-sm">
                Password Setup
              </h1>
              <p className="text-blue-400 font-bold mt-1 tracking-widest uppercase text-[10px]">
                Contact Center System
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
              <p className="text-sm text-gray-300 text-center">
                И-мэйлээр ирсэн холбоосоор өөрийн шинэ нууц үгээ тохируулна уу.
              </p>

              {error && (
                <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200 text-sm text-center">
                  {error}
                </div>
              )}
              {message && (
                <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-xl text-green-100 text-sm text-center">
                  {message}
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 dark:text-gray-300 uppercase tracking-wider ml-1">
                  Шинэ нууц үг
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                    <Lock size={18} />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full pl-11 pr-12 py-3.5 bg-gray-800/50 dark:bg-black/50 border border-white/5 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-white transition-all placeholder-gray-500 font-medium"
                    placeholder="Том, жижиг үсэг болон тоо агуулсан"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-blue-500 transition-colors"
                    aria-label={showPassword ? 'Нууц үг нуух' : 'Нууц үг харах'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 dark:text-gray-300 uppercase tracking-wider ml-1">
                  Шинэ нууц үг давтах
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-3.5 bg-gray-800/50 dark:bg-black/50 border border-white/5 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-white transition-all placeholder-gray-500 font-medium"
                  placeholder="Шинэ нууц үгээ давтана уу"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl font-bold tracking-wide transition-all duration-300 bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700 disabled:from-gray-800 disabled:to-gray-800 disabled:text-gray-500"
              >
                {loading ? 'Хадгалж байна...' : 'Нууц үг тохируулах'}
              </button>
            </form>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
