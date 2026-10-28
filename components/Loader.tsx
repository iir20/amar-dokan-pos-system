
import React from 'react';
import { APP_LOGO } from '../constants';

const Loader: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[300px] w-full p-8 animate-fade-in">
      <div className="relative w-20 h-20 mb-6">
        {/* Pulse Effect */}
        <div className="absolute inset-0 bg-emerald-100 rounded-full animate-ping opacity-75"></div>
        {/* Logo */}
        <div className="relative z-10 w-full h-full drop-shadow-lg animate-[bounce_2s_infinite]">
             <img src={APP_LOGO} alt="Loading..." className="w-full h-full object-contain" />
        </div>
      </div>
      
      {/* Text Shimmer */}
      <div className="space-y-2 text-center">
          <h3 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-teal-500 animate-pulse">
            Loading...
          </h3>
          <div className="flex gap-1.5 justify-center">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce"></div>
          </div>
      </div>
    </div>
  );
};

export default Loader;
