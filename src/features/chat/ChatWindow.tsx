import React, { useState, useRef, useEffect } from 'react';
import { X, Send, Bot, User } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

interface ChatWindowProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChatWindow({ isOpen, onClose }: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: 'Сайн байна уу? Би таны AI туслах байна. Танд юугаар туслах вэ?',
      sender: 'ai',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      text: input,
      sender: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    // Simulate AI response
    setTimeout(() => {
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        text: 'Одоогоор би туршилтын шатанд явж байна. Удахгүй илүү ухаалаг болох болно!',
        sender: 'ai',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiMsg]);
      setIsTyping(false);
    }, 1000);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="fixed bottom-24 right-4 sm:right-8 w-[calc(100%-2rem)] sm:w-80 bg-gray-900/95 backdrop-blur-xl border border-gray-700/50 rounded-2xl shadow-2xl overflow-hidden z-50 flex flex-col"
          style={{ height: '450px', maxWidth: '350px' }}
        >
          {/* Header */}
          <div className="p-4 border-b border-gray-700/50 flex justify-between items-center bg-blue-600/10">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-900/20">
                <Bot size={18} className="text-white" />
              </div>
              <div>
                <h3 className="text-white font-bold text-sm">AI Туслах</h3>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-[10px] text-gray-400 font-medium">Онлайн</span>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-white hover:bg-white/5 rounded-lg transition-all">
              <X size={20} />
            </button>
          </div>
          
          {/* Messages Area */}
          <div ref={scrollRef} className="flex-1 p-4 overflow-y-auto flex flex-col gap-4 custom-scrollbar bg-black/20">
            {messages.map((msg) => (
              <div 
                key={msg.id} 
                className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div className={`max-w-[85%] p-3 rounded-2xl text-xs leading-relaxed shadow-sm ${
                  msg.sender === 'user' 
                    ? 'bg-blue-600 text-white rounded-tr-none' 
                    : 'bg-gray-800 text-gray-100 rounded-tl-none border border-gray-700'
                }`}>
                  {msg.text}
                </div>
                <span className="text-[9px] text-gray-600 mt-1 px-1">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
            {isTyping && (
              <div className="flex items-start gap-2">
                <div className="bg-gray-800 border border-gray-700 p-3 rounded-2xl rounded-tl-none flex gap-1">
                  <div className="w-1 h-1 bg-gray-500 rounded-full animate-bounce"></div>
                  <div className="w-1 h-1 bg-gray-500 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                  <div className="w-1 h-1 bg-gray-500 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                </div>
              </div>
            )}
          </div>
          
          {/* Input Area */}
          <div className="p-3 border-t border-gray-700/50 bg-gray-900/50 flex gap-2">
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Асуултаа энд бичнэ үү..." 
              className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-blue-500 transition-all placeholder:text-gray-600"
            />
            <button 
              onClick={handleSend}
              disabled={!input.trim()}
              className={`p-2 rounded-xl transition-all ${
                input.trim() ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-900/20' : 'bg-gray-800 text-gray-600 cursor-not-allowed'
              }`}
            >
              <Send size={18} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
