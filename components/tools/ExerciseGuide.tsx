import React, { useState, useEffect, useRef } from 'react';
import { getExerciseGifUrl } from '../../services/exerciseGifService';
import { Loader2 } from 'lucide-react';

interface ExerciseGuideProps {
    exerciseName: string;
    className?: string;
}

export const ExerciseGuide: React.FC<ExerciseGuideProps> = ({ exerciseName, className = '' }) => {
    const [images, setImages] = useState<string[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        let mounted = true;
        setLoading(true);
        setError(false);
        setImages([]);

        setCurrentIndex(0);
        getExerciseGifUrl(exerciseName)
            .then(urls => {
                if (!mounted) return;
                if (urls && urls.length > 0) {
                    setImages(urls);
                } else {
                    setError(true);
                }
            })
            .catch(() => {
                if (mounted) setError(true);
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });

        return () => {
            mounted = false;
        };
    }, [exerciseName]);

    useEffect(() => {
        if (images.length > 1) {
            intervalRef.current = setInterval(() => {
                setCurrentIndex(prev => (prev + 1) % images.length);
            }, 800); // 800ms per frame for a clear 2-step animation
        }

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [images]);

    if (loading) {
        return (
            <div className={`w-full aspect-video bg-sand-50 rounded-xl flex items-center justify-center border border-sand-200 ${className}`}>
                <Loader2 className="w-6 h-6 text-sand-400 animate-spin" />
            </div>
        );
    }

    if (error || images.length === 0) {
        return null; // Don't show anything if no guide found (saves space)
    }

    return (
        <div className={`relative w-full overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm group ${className}`}>
            <div className="aspect-[4/3] w-full relative">
                {/* Preload all images but only show current */}
                {images.map((img, idx) => (
                    <img
                        key={img}
                        src={img}
                        alt={`${exerciseName} step ${idx + 1}`}
                        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${idx === currentIndex ? 'opacity-100' : 'opacity-0'
                            }`}
                        loading="lazy"
                    />
                ))}
            </div>

            {/* Playback Indicator */}
            <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/50 backdrop-blur-md rounded text-[10px] font-medium text-white/90">
                GUIDE
            </div>
        </div>
    );
};
