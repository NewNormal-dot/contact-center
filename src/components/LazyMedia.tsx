import React, { useState, useEffect, useRef } from 'react';

interface LazyMediaProps {
  src: string;
  alt?: string;
  type: 'Image' | 'Video';
  className?: string;
  poster?: string;
  controls?: boolean;
  objectFit?: 'cover' | 'contain';
}

export const LazyMedia: React.FC<LazyMediaProps> = ({ 
  src, 
  alt, 
  type, 
  className = "", 
  poster, 
  controls = true,
  objectFit = 'cover'
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const mediaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: '50px' }
    );

    if (mediaRef.current) {
      observer.observe(mediaRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={mediaRef} className={`relative overflow-hidden ${className}`}>
      {isVisible ? (
        type === 'Image' ? (
          <img 
            src={src} 
            alt={alt} 
            className={`w-full h-full ${objectFit === 'cover' ? 'object-cover' : 'object-contain'}`} 
            referrerPolicy="no-referrer" 
          />
        ) : (
          <video 
            src={src} 
            poster={poster} 
            controls={controls} 
            className={`w-full h-full ${objectFit === 'cover' ? 'object-cover' : 'object-contain'}`} 
          />
        )
      ) : (
        <div className="w-full h-full bg-gray-800/50 animate-pulse flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
};
