import React, { useState } from 'react';
import { MapPin, Navigation, Clock, Footprints, Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';

interface MapWidgetProps {
  locationName: string;
  address?: string;
  query: string;
  distanceKm?: number;
  walkingMinutes?: number;
}

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

export const MapWidget: React.FC<MapWidgetProps> = ({
  locationName,
  address,
  query,
  distanceKm,
  walkingMinutes
}) => {
  const [mapLoaded, setMapLoaded] = useState(false);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || locationName)}`;

  const staticMapUrl = MAPS_API_KEY
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(query || locationName)}&zoom=15&size=400x200&scale=2&maptype=roadmap&markers=color:0xE87A38%7C${encodeURIComponent(query || locationName)}&style=feature:all%7Csaturation:-20&key=${MAPS_API_KEY}`
    : null;

  const estimatedMinutes = walkingMinutes || (distanceKm ? Math.round(distanceKm * 12) : null);

  return (
    <div className="bg-white/90 backdrop-blur-sm p-2 sm:p-2.5 rounded-3xl sm:rounded-4xl shadow-soft-lg w-full max-w-sm animate-slide-up-fade overflow-hidden border border-sand-200">
      <div className="relative h-36 sm:h-44 bg-gradient-to-br from-sand-100 to-sand-200 rounded-2xl sm:rounded-3xl overflow-hidden group">

        {staticMapUrl ? (
          <>
            {!mapLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-sand-100">
                <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 text-sand-400 animate-spin" />
              </div>
            )}
            <img
              src={staticMapUrl}
              alt={`Map of ${locationName}`}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${mapLoaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setMapLoaded(true)}
              onError={() => setMapLoaded(true)}
            />
          </>
        ) : (
          <>
            <div className="absolute inset-0 opacity-30">
              <svg width="100%" height="100%" className="text-sand-400">
                <pattern id="mapGridClaude" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" />
                </pattern>
                <rect width="100%" height="100%" fill="url(#mapGridClaude)" />
              </svg>
            </div>

            <svg className="absolute inset-0 w-full h-full opacity-50">
              <path d="M0,100 Q100,50 200,100 T400,80" stroke="url(#routeGradientClaude)" strokeWidth="4" fill="none" strokeLinecap="round" strokeDasharray="8 4" className="animate-gradient-shift" />
              <defs>
                <linearGradient id="routeGradientClaude" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#E87A38" />
                  <stop offset="100%" stopColor="#2A9D8F" />
                </linearGradient>
              </defs>
            </svg>

            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative">
                <div className="absolute inset-0 w-11 h-11 sm:w-14 sm:h-14 bg-claude-400/30 rounded-full animate-ping"></div>
                <div className="absolute inset-1.5 sm:inset-2 w-8 h-8 sm:w-10 sm:h-10 bg-claude-300/20 rounded-full animate-breathe"></div>
                <div className="relative w-11 h-11 sm:w-14 sm:h-14 bg-white border border-claude-200 rounded-full shadow-glow-claude flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                  <MapPin className="w-5 h-5 sm:w-7 sm:h-7 text-claude-600 fill-claude-600" />
                </div>
              </div>
            </div>
          </>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-sand-100/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
      </div>

      <div className="px-3 sm:px-4 pb-3 sm:pb-4 pt-3 sm:pt-4">
        <h4 className="font-display font-bold text-ink-800 text-base sm:text-lg">{locationName}</h4>
        {address && <p className="text-xs sm:text-sm text-ink-400 font-body mb-2 truncate">{address}</p>}

        {(distanceKm || estimatedMinutes) && (
          <div className="flex items-center gap-3 sm:gap-4 mb-3 sm:mb-4 text-xs sm:text-sm">
            {distanceKm && (
              <div className="flex items-center text-ink-500">
                <Footprints className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 text-zen-500" />
                <span>{distanceKm.toFixed(1)} km</span>
              </div>
            )}
            {estimatedMinutes && (
              <div className="flex items-center text-ink-500">
                <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 text-claude-500" />
                <span>~{estimatedMinutes} min walk</span>
              </div>
            )}
          </div>
        )}

        <a href={mapsUrl} target="_blank" rel="noreferrer" className="block">
          <Button variant="secondary" className="w-full rounded-xl sm:rounded-2xl h-10 sm:h-12 text-xs sm:text-sm">
            <Navigation className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2 text-accent-teal" />
            <span className="font-display font-semibold">Open in Maps</span>
          </Button>
        </a>
      </div>
    </div>
  );
};