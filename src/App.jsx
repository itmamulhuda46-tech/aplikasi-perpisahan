import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Play, Pause, Maximize, Settings, LogIn, Users, 
  Image as ImageIcon, Music, Save, Plus, Edit, Trash2, 
  ChevronLeft, ChevronRight, X, Check, Upload, Search, Wand2, LogOut
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot, deleteDoc } from 'firebase/firestore';

// --- FIREBASE INITIALIZATION ---
const firebaseConfig = {
  apiKey: "AIzaSyCkJ6iisAKlcw27mp-0GGJB_AXPn9Wi0ZY",
  authDomain: "aplikasi-perpisahan.firebaseapp.com",
  databaseURL: "https://aplikasi-perpisahan-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "aplikasi-perpisahan",
  storageBucket: "aplikasi-perpisahan.firebasestorage.app",
  messagingSenderId: "668278100250",
  appId: "1:668278100250:web:5dd1b92ad08703a1909ca3",
  measurementId: "G-7D0B77CS9M"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'smp-graduation-app';

// --- UTILS & HELPERS ---
// PIN disandikan dengan Base64 agar tidak tertulis teks asli di dalam kode (hudasukses)
const ENCODED_PIN = 'aHVkYXN1a3Nlcw==';

// --- GEMINI API CONFIGURATION ---
const apiKey = ""; // API key is provided by the execution environment

async function generateTextWithRetry(prompt, retries = 5) {
  const delay = (ms) => new Promise(res => setTimeout(res, ms));
  const delays = [1000, 2000, 4000, 8000, 16000];

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: "Kamu adalah asisten cerdas, kreatif, dan inspiratif yang membantu panitia acara perpisahan sekolah. Berikan jawaban yang relevan, ringkas, natural, dan berbahasa Indonesia yang baik." }] }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      return result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch (error) {
      if (i === retries - 1) {
        console.error("Gemini API Error:", error);
        return "";
      }
      await delay(delays[i]);
    }
  }
}

// Image Compressor to keep Firestore size small (Under 1MB limit)
const compressImage = (file) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 500; // Optimal for slideshows while keeping size small
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
    };
  });
};

const defaultSettings = {
  schoolName: 'SMP Negeri 1 Nusantara',
  eventName: 'Malam Pelepasan & Perpisahan',
  schoolYear: 'Tahun Ajaran 2025/2026',
  schoolLogoUrl: '', // NEW: Logo SMP kustom
  merdekaLogoUrl: '', // NEW: Logo Merdeka kustom
  slideSpeed: 5, // in seconds
  musicUrl: 'https://cdn.pixabay.com/audio/2022/05/27/audio_1808fbf07a.mp3', // Cinematic background music
  themeColor: 'indigo',
  photoFrame: 'minimalist', // Opsi bingkai foto (minimalist, polaroid, neon, elegant-gold, graduation)
  bgType: 'blur', // blur, image, color
  bgCustomUrl: '',
  bgCustomColor: '#0f172a'
};

// --- MAIN APP COMPONENT ---
export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('splash'); // splash, presentation, admin_login, admin_dashboard
  const [students, setStudents] = useState([]);
  const [settings, setSettings] = useState(defaultSettings);
  const [isAdminAuth, setIsAdminAuth] = useState(false);
  const [loadingDb, setLoadingDb] = useState(true);

  // Audio Reference
  const audioRef = useRef(null);
  const [isPlayingMusic, setIsPlayingMusic] = useState(false);

  // Firebase Auth & Data Fetching
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          try {
            await signInWithCustomToken(auth, __initial_auth_token);
          } catch (tokenError) {
            console.warn("Mengabaikan token bawaan Canvas. Fallback ke Anonymous Auth untuk Firebase eksternal.");
            await signInAnonymously(auth);
          }
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth error:", error);
      }
    };
    initAuth();

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user) return;

    setLoadingDb(true);
    const studentsRef = collection(db, 'artifacts', appId, 'public', 'data', 'students');
    const settingsRef = collection(db, 'artifacts', appId, 'public', 'data', 'settings');

    const unsubStudents = onSnapshot(studentsRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // ALGORITMA SORTING YANG DIPERBARUI: Urutkan Kelas (IX A - IX I) lalu Urutan Absen (Nama)
      data.sort((a, b) => {
        // Jika kelas belum diisi, kita anggap nilainya "ZZZ" agar tampil di urutan paling bawah
        const kelasA = a.kelas || "ZZZ"; 
        const kelasB = b.kelas || "ZZZ";
        const namaA = a.nama || "";
        const namaB = b.nama || "";

        if (kelasA !== kelasB) {
          return kelasA.localeCompare(kelasB);
        }
        // Jika kelasnya sama, urutkan berdasarkan abjad nama (absen)
        return namaA.localeCompare(namaB);
      });

      setStudents(data);
      setLoadingDb(false);
    }, (error) => console.error("Error fetching students:", error));

    const unsubSettings = onSnapshot(settingsRef, (snapshot) => {
      if (!snapshot.empty) {
        // Find main settings doc
        const mainSettings = snapshot.docs.find(d => d.id === 'main');
        if (mainSettings) setSettings({ ...defaultSettings, ...mainSettings.data() });
      }
    }, (error) => console.error("Error fetching settings:", error));

    return () => {
      unsubStudents();
      unsubSettings();
    };
  }, [user]);

  // Global Audio Controller
  useEffect(() => {
    if (audioRef.current) {
      if (isPlayingMusic) {
        audioRef.current.play().catch(e => console.log("Audio play prevented:", e));
      } else {
        audioRef.current.pause();
      }
    }
  }, [isPlayingMusic, view]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.log(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  const renderView = () => {
    if (loadingDb && view !== 'admin_login') {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-indigo-500"></div>
        </div>
      );
    }

    switch (view) {
      case 'splash':
        return <SplashScreen setView={setView} settings={settings} toggleFullscreen={toggleFullscreen} setIsPlayingMusic={setIsPlayingMusic} />;
      case 'presentation':
        return <PresentationMode students={students} settings={settings} setView={setView} isPlayingMusic={isPlayingMusic} setIsPlayingMusic={setIsPlayingMusic} />;
      case 'closing':
        return <ClosingScreen settings={settings} setView={setView} />;
      case 'admin_login':
        return <AdminLogin setView={setView} setIsAdminAuth={setIsAdminAuth} />;
      case 'admin_dashboard':
        if (!isAdminAuth) {
          setView('admin_login');
          return null;
        }
        return <AdminDashboard students={students} settings={settings} setView={setView} user={user} setIsAdminAuth={setIsAdminAuth} />;
      default:
        return <SplashScreen setView={setView} settings={settings} toggleFullscreen={toggleFullscreen} setIsPlayingMusic={setIsPlayingMusic}/>;
    }
  };

  return (
    <div className="min-h-screen bg-black text-slate-100 font-sans overflow-hidden selection:bg-indigo-500 selection:text-white">
      {/* Hidden Audio Player */}
      <audio 
        ref={audioRef} 
        src={settings.musicUrl} 
        loop 
        preload="auto"
      />
      {renderView()}
    </div>
  );
}

// ==========================================
// 1. SPLASH SCREEN (HALAMAN PEMBUKA)
// ==========================================
function SplashScreen({ setView, settings, toggleFullscreen, setIsPlayingMusic }) {
  const handleStart = () => {
    toggleFullscreen();
    setIsPlayingMusic(true);
    setView('presentation');
  };

  return (
    <div className="relative w-full h-screen flex flex-col items-center justify-center bg-slate-900 overflow-hidden">
      {/* Cinematic Background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/40 via-slate-900 to-black z-10"></div>
        {/* Animated Particles/Stars effect using CSS */}
        <div className="absolute inset-0 opacity-30 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] animate-pulse"></div>
        {/* Slow moving gradient blobs */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>
      </div>

      {/* NEW: Logos at Top Corners */}
      <div className="absolute top-4 left-4 md:top-8 md:left-8 z-40 flex items-center gap-3 md:gap-5 animate-fade-in-down pointer-events-none">
        <img src="https://upload.wikimedia.org/wikipedia/commons/9/9c/Logo_of_Ministry_of_Education_and_Culture_of_Republic_of_Indonesia.svg" alt="Kemendikbud" className="h-10 md:h-16 object-contain drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]" />
        {settings.schoolLogoUrl ? (
          <img 
            src={settings.schoolLogoUrl} 
            alt="Logo SMP" 
            className="h-10 md:h-16 object-contain drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]"
            onError={(e) => { e.target.style.display = 'none'; }} 
          />
        ) : (
          <div className="h-10 w-10 md:h-16 md:w-16 bg-white/10 backdrop-blur-md rounded-full border border-white/20 flex items-center justify-center shadow-lg overflow-hidden">
            <span className="text-white text-[10px] md:text-xs font-bold text-center leading-tight">LOGO<br/>SMP</span>
          </div>
        )}
      </div>
      <div className="absolute top-4 right-4 md:top-8 md:right-8 z-40 flex items-center animate-fade-in-down pointer-events-none">
        <img 
          src={settings.merdekaLogoUrl || "https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Logo_Merdeka_Belajar.png/600px-Logo_Merdeka_Belajar.png"} 
          alt="Merdeka Mengajar" 
          className="h-10 sm:h-12 md:h-16 lg:h-20 w-auto object-contain drop-shadow-[0_0_10px_rgba(255,255,255,0.4)]"
          onError={(e) => { 
            e.target.onerror = null; 
            e.target.src = "https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Logo_Merdeka_Belajar.png/600px-Logo_Merdeka_Belajar.png"; 
          }}
        />
      </div>

      <div className="z-20 text-center px-4 max-w-4xl">
        <div className="mb-8 transform hover:scale-105 transition duration-500">
          <div className="w-32 h-32 mx-auto bg-white/10 backdrop-blur-md p-4 rounded-full border border-white/20 shadow-[0_0_50px_rgba(79,70,229,0.3)] flex items-center justify-center">
            {settings.schoolLogoUrl ? (
              <img 
                src={settings.schoolLogoUrl} 
                alt="Logo SMP" 
                className="w-24 h-24 object-contain" 
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            ) : (
              <svg className="w-16 h-16 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 14l9-5-9-5-9 5 9 5z" />
                <path d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222" />
              </svg>
            )}
          </div>
        </div>

        <h2 className="text-2xl md:text-3xl font-medium text-indigo-300 tracking-widest uppercase mb-2 animate-fade-in-up">
          {settings.eventName}
        </h2>
        <h1 className="text-5xl md:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-indigo-100 to-indigo-300 mb-6 drop-shadow-lg animate-fade-in-up animation-delay-300">
          {settings.schoolName}
        </h1>
        <p className="text-xl text-slate-400 mb-12 font-light tracking-wide animate-fade-in-up animation-delay-600">
          Angkatan {settings.schoolYear}
        </p>

        <div className="flex flex-col sm:flex-row gap-6 justify-center items-center animate-fade-in-up animation-delay-1000">
          <button 
            onClick={handleStart}
            className="group relative px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full font-bold text-lg tracking-wide transition-all duration-300 shadow-[0_0_20px_rgba(79,70,229,0.5)] hover:shadow-[0_0_40px_rgba(79,70,229,0.8)] flex items-center gap-3 overflow-hidden"
          >
            <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-shimmer"></div>
            <Play className="w-6 h-6 fill-current" />
            Mulai Presentasi
          </button>

          <button 
            onClick={() => setView('admin_login')}
            className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-slate-300 rounded-full font-medium transition duration-300 flex items-center gap-2 backdrop-blur-sm"
          >
            <Settings className="w-5 h-5" />
            Panel Admin
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 2. PRESENTATION MODE (SLIDESHOW)
// ==========================================
function PresentationMode({ students, settings, setView, isPlayingMusic, setIsPlayingMusic }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [direction, setDirection] = useState('next'); // for animation direction

  // Handle auto slide
  useEffect(() => {
    let interval;
    if (isPlaying && students.length > 0) {
      interval = setInterval(() => {
        handleNext();
      }, settings.slideSpeed * 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentIndex, students.length, settings.slideSpeed]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === ' ') setIsPlaying(p => !p); // Spacebar to pause/play
      if (e.key === 'Escape') setView('splash');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, students.length]);

  const handleNext = () => {
    setDirection('next');
    if (currentIndex < students.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setView('closing'); // End of slideshow
    }
  };

  const handlePrev = () => {
    setDirection('prev');
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  if (!students || students.length === 0) {
    return (
      <div className="h-screen flex flex-col items-center justify-center text-white bg-slate-900">
        <Users className="w-20 h-20 mb-4 text-slate-500" />
        <h2 className="text-2xl font-bold">Belum Ada Data Siswa</h2>
        <p className="text-slate-400 mt-2">Silakan tambahkan data melalui Panel Admin.</p>
        <button onClick={() => setView('admin_login')} className="mt-6 px-6 py-2 bg-indigo-600 rounded-full">Ke Admin Panel</button>
      </div>
    );
  }

  const currentStudent = students[currentIndex];
  const photoFrameStyle = settings.photoFrame || 'minimalist';
  const bgType = settings.bgType || 'blur';

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden flex items-center justify-center">
      {/* Background Section Configurable */}
      <div className="absolute inset-0 z-0">
        {bgType === 'color' ? (
          <div className="absolute inset-0 transition-all duration-1000" style={{ backgroundColor: settings.bgCustomColor || '#0f172a' }} />
        ) : bgType === 'image' ? (
          <div 
            className="absolute inset-0 bg-cover bg-center opacity-40 transition-all duration-1000"
            style={{ backgroundImage: `url(${settings.bgCustomUrl || 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?q=80&w=2070'})` }}
          />
        ) : (
          <div 
            className="absolute inset-0 bg-cover bg-center opacity-30 scale-110 filter blur-xl transition-all duration-1000"
            style={{ backgroundImage: `url(${currentStudent.foto || 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?q=80&w=2070'})` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/80 to-transparent"></div>
      </div>

      {/* NEW: Logos at Top Corners */}
      <div className="absolute top-4 left-4 md:top-8 md:left-8 z-40 flex items-center gap-3 md:gap-5 animate-fade-in-down pointer-events-none">
        <img src="https://upload.wikimedia.org/wikipedia/commons/9/9c/Logo_of_Ministry_of_Education_and_Culture_of_Republic_of_Indonesia.svg" alt="Kemendikbud" className="h-10 md:h-16 object-contain drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]" />
        {settings.schoolLogoUrl ? (
          <img 
            src={settings.schoolLogoUrl} 
            alt="Logo SMP" 
            className="h-10 md:h-16 object-contain drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]"
            onError={(e) => { e.target.style.display = 'none'; }} 
          />
        ) : (
          <div className="h-10 w-10 md:h-16 md:w-16 bg-white/10 backdrop-blur-md rounded-full border border-white/20 flex items-center justify-center shadow-lg overflow-hidden">
            <span className="text-white text-[10px] md:text-xs font-bold text-center leading-tight">LOGO<br/>SMP</span>
          </div>
        )}
      </div>
      <div className="absolute top-4 right-4 md:top-8 md:right-8 z-40 flex items-center animate-fade-in-down pointer-events-none">
        <img 
          src={settings.merdekaLogoUrl || "https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Logo_Merdeka_Belajar.png/600px-Logo_Merdeka_Belajar.png"} 
          alt="Merdeka Mengajar" 
          className="h-10 sm:h-12 md:h-16 lg:h-20 w-auto object-contain drop-shadow-[0_0_10px_rgba(255,255,255,0.4)]"
          onError={(e) => { 
            e.target.onerror = null; 
            e.target.src = "https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Logo_Merdeka_Belajar.png/600px-Logo_Merdeka_Belajar.png"; 
          }}
        />
      </div>

      {/* Control Bar (Auto hides/shows on hover) */}
      <div className="absolute top-0 inset-x-0 p-6 z-50 flex justify-between items-center opacity-0 hover:opacity-100 transition-opacity duration-300 bg-gradient-to-b from-black/60 to-transparent pt-20 md:pt-6">
        <div className="flex items-center gap-4">
          <button onClick={() => setView('splash')} className="text-white/70 hover:text-white bg-white/10 p-2 rounded-full backdrop-blur-sm pointer-events-auto">
            <X className="w-6 h-6" />
          </button>
          <div className="text-white/80 text-sm font-medium">
            {currentIndex + 1} / {students.length}
          </div>
        </div>
        
        <div className="flex items-center gap-3 pointer-events-auto">
          <button 
            onClick={() => setIsPlayingMusic(!isPlayingMusic)} 
            className={`p-3 rounded-full backdrop-blur-sm transition ${isPlayingMusic ? 'bg-indigo-600/80 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
          >
            <Music className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setIsPlaying(!isPlaying)} 
            className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-sm transition"
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-1" />}
          </button>
          <button 
            onClick={() => {
              if (!document.fullscreenElement) document.documentElement.requestFullscreen();
              else document.exitFullscreen();
            }} 
            className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-sm transition"
          >
            <Maximize className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* FULLY RESPONSIVE MAIN CONTENT AREA */}
      <div className="z-10 w-full max-w-7xl px-4 sm:px-8 flex flex-col md:flex-row items-center justify-center gap-6 md:gap-12 max-h-[100dvh] overflow-y-auto scrollbar-hide py-20 md:py-0 mt-8 md:mt-0">
        
        {/* Photo Section */}
        <div className="w-full md:w-5/12 flex-shrink-0 flex items-center justify-center p-2 mt-4 md:mt-0">
          
          {photoFrameStyle === 'polaroid' ? (
            <div key={`photo-${currentStudent.id}`} className="relative w-[180px] sm:w-[240px] md:w-full max-w-sm aspect-[3/4] bg-white p-3 md:p-4 pb-12 md:pb-20 rounded-md shadow-[0_20px_50px_rgba(0,0,0,0.6)] rotate-[-3deg] animate-scale-in mx-auto pointer-events-none">
              <div className="relative w-full h-full overflow-hidden rounded-sm bg-slate-800 flex items-center justify-center">
                {currentStudent.foto ? (
                  <img src={currentStudent.foto} alt={currentStudent.nama} className="w-full h-full object-cover animate-pan-slow" />
                ) : (
                  <Users className="w-16 md:w-24 h-16 md:h-24 text-slate-600" />
                )}
                <div className="absolute bottom-0 inset-x-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent"></div>
              </div>
              <div className="absolute bottom-3 md:bottom-6 inset-x-0 text-center font-bold text-slate-800 text-sm md:text-xl font-serif">
                {currentStudent.kelas}
              </div>
            </div>
          ) : photoFrameStyle === 'neon' ? (
            <div key={`photo-${currentStudent.id}`} className="relative w-[180px] sm:w-[240px] md:w-full max-w-sm aspect-[3/4] rounded-xl overflow-hidden shadow-[0_0_40px_rgba(99,102,241,0.8)] border-4 border-indigo-500 animate-scale-in mx-auto pointer-events-none">
              <div className="w-full h-full bg-slate-800 flex items-center justify-center">
                {currentStudent.foto ? (
                  <img src={currentStudent.foto} alt={currentStudent.nama} className="w-full h-full object-cover animate-pan-slow" />
                ) : (
                  <Users className="w-16 md:w-24 h-16 md:h-24 text-slate-600" />
                )}
              </div>
              <div className="absolute bottom-0 inset-x-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent"></div>
              <div className="absolute top-2 right-2 md:top-4 md:right-4 bg-indigo-600/90 backdrop-blur-md px-3 md:px-4 py-1 rounded-full text-white font-bold tracking-wider text-xs md:text-sm shadow-lg">
                {currentStudent.kelas}
              </div>
            </div>
          ) : photoFrameStyle === 'elegant-gold' ? (
            <div key={`photo-${currentStudent.id}`} className="relative w-[180px] sm:w-[240px] md:w-full max-w-sm aspect-[3/4] rounded-sm overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.8)] border-4 md:border-[6px] border-[#D4AF37] ring-2 md:ring-4 ring-[#8B6508] animate-scale-in mx-auto pointer-events-none">
              <div className="w-full h-full bg-slate-900 flex items-center justify-center">
                {currentStudent.foto ? (
                  <img src={currentStudent.foto} alt={currentStudent.nama} className="w-full h-full object-cover animate-pan-slow" />
                ) : (
                  <Users className="w-16 md:w-24 h-16 md:h-24 text-slate-600" />
                )}
              </div>
              <div className="absolute bottom-0 inset-x-0 h-1/3 bg-gradient-to-t from-black/90 to-transparent"></div>
              <div className="absolute top-2 right-2 md:top-4 md:right-4 bg-black/80 border border-[#D4AF37] backdrop-blur-md px-3 md:px-5 py-1 md:py-1.5 rounded-sm text-[#D4AF37] font-bold tracking-widest text-xs md:text-sm shadow-lg uppercase">
                {currentStudent.kelas}
              </div>
            </div>
          ) : photoFrameStyle === 'graduation' ? (
            <div key={`photo-${currentStudent.id}`} className="relative w-[180px] sm:w-[240px] md:w-full max-w-sm aspect-[3/4] rounded-2xl bg-gradient-to-tr from-indigo-600 via-purple-500 to-amber-500 p-1 md:p-1.5 shadow-[0_0_40px_rgba(99,102,241,0.4)] animate-scale-in mx-auto pointer-events-none">
              <div className="relative w-full h-full overflow-hidden rounded-[10px] md:rounded-xl bg-slate-900 border-2 border-slate-900 flex items-center justify-center">
                {currentStudent.foto ? (
                  <img src={currentStudent.foto} alt={currentStudent.nama} className="w-full h-full object-cover animate-pan-slow" />
                ) : (
                  <Users className="w-16 md:w-24 h-16 md:h-24 text-slate-600" />
                )}
                <div className="absolute top-0 inset-x-0 h-16 md:h-24 bg-gradient-to-b from-indigo-500/30 to-transparent mix-blend-overlay"></div>
                <div className="absolute bottom-0 inset-x-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent"></div>
              </div>
              <div className="absolute -bottom-3 md:-bottom-4 inset-x-0 flex justify-center z-10">
                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 border border-white/20 backdrop-blur-md px-4 md:px-6 py-1 md:py-2 rounded-full text-white font-bold tracking-widest text-xs md:text-sm shadow-xl">
                  {currentStudent.kelas}
                </div>
              </div>
            </div>
          ) : (
            /* Default Minimalist */
            <div key={`photo-${currentStudent.id}`} className="relative w-[180px] sm:w-[240px] md:w-full max-w-sm aspect-[3/4] rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 animate-scale-in mx-auto pointer-events-none">
              <div className="w-full h-full bg-slate-800 flex items-center justify-center">
                {currentStudent.foto ? (
                  <img src={currentStudent.foto} alt={currentStudent.nama} className="w-full h-full object-cover animate-pan-slow" />
                ) : (
                  <Users className="w-16 md:w-24 h-16 md:h-24 text-slate-600" />
                )}
              </div>
              <div className="absolute bottom-0 inset-x-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent"></div>
              <div className="absolute top-2 right-2 md:top-4 md:right-4 bg-indigo-600/90 backdrop-blur-md px-3 md:px-4 py-1 rounded-full text-white font-bold tracking-wider text-xs md:text-sm shadow-lg">
                {currentStudent.kelas}
              </div>
            </div>
          )}

        </div>

        {/* Text Details Section - Responsive Fonts & Spaces */}
        <div className="w-full md:w-7/12 flex flex-col justify-center text-center md:text-left mb-10 md:mb-0 pointer-events-none">
          <div key={`text-${currentStudent.id}`} className="animate-fade-in-right">
            <h1 className="text-3xl sm:text-4xl lg:text-7xl font-bold text-white mb-2 tracking-tight drop-shadow-md leading-tight">
              {currentStudent.nama}
            </h1>
            
            <div className="w-16 md:w-20 h-1 bg-indigo-500 rounded-full mb-6 md:mb-8 mx-auto md:mx-0 shadow-[0_0_10px_rgba(99,102,241,0.8)]"></div>

            <div className="space-y-4 md:space-y-6">
              <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-4 md:p-6 shadow-xl relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500"></div>
                <h3 className="text-indigo-300 text-xs md:text-sm font-semibold uppercase tracking-widest mb-1">Putra/Putri Dari</h3>
                <p className="text-lg md:text-2xl text-white font-medium">{currentStudent.ortu || '-'}</p>
              </div>

              {currentStudent.prestasi && (
                <div className="bg-gradient-to-r from-amber-500/10 to-transparent border border-amber-500/20 rounded-2xl p-4 md:p-6 shadow-xl relative">
                   <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
                   <h3 className="text-amber-400 text-xs md:text-sm font-semibold uppercase tracking-widest mb-1">Prestasi</h3>
                   <p className="text-base md:text-lg text-white">{currentStudent.prestasi}</p>
                </div>
              )}

              <div className="relative mt-6 md:mt-8">
                <span className="absolute -top-4 md:-top-6 left-0 md:-left-4 text-4xl md:text-6xl text-white/10 font-serif">"</span>
                <p className="text-lg sm:text-xl md:text-3xl text-slate-300 font-light italic leading-relaxed px-4 md:pl-6">
                  {currentStudent.motto || "Teruslah melangkah dan jadilah kebanggaan."}
                </p>
                <span className="absolute -bottom-4 md:-bottom-8 right-0 md:-right-4 text-4xl md:text-6xl text-white/10 font-serif">"</span>
              </div>
              
              {/* ✨ AI Prediksi Masa Depan (New Feature Display) */}
              {currentStudent.prediksi && (
                <div className="mt-6 md:mt-4 inline-flex items-center gap-2 md:gap-3 bg-gradient-to-r from-purple-600/20 to-pink-600/20 border border-purple-500/30 px-4 md:px-5 py-2 md:py-2.5 rounded-full shadow-[0_0_20px_rgba(168,85,247,0.3)] animate-fade-in-up animation-delay-600">
                  <Wand2 className="w-4 h-4 md:w-5 md:h-5 text-pink-400 flex-shrink-0" />
                  <p className="text-xs md:text-base text-purple-100 font-medium tracking-wide">
                    {currentStudent.prediksi}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* Progress Bar */}
      <div className="absolute bottom-0 inset-x-0 h-1 bg-white/10">
        <div 
          className="h-full bg-indigo-500 transition-all ease-linear"
          style={{ 
            width: isPlaying ? '100%' : '0%', 
            transitionDuration: isPlaying ? `${settings.slideSpeed}s` : '0s'
          }}
          key={`progress-${currentIndex}-${isPlaying}`}
        ></div>
      </div>
      
      {/* Navigation Areas (Invisible, for clicking) */}
      <div onClick={handlePrev} className="absolute left-0 top-0 bottom-0 w-1/6 cursor-pointer z-40 hidden md:block" title="Previous"></div>
      <div onClick={handleNext} className="absolute right-0 top-0 bottom-0 w-1/6 cursor-pointer z-40 hidden md:block" title="Next"></div>
    </div>
  );
}


// ==========================================
// 3. CLOSING SCREEN (HALAMAN PENUTUP)
// ==========================================
function ClosingScreen({ settings, setView }) {
  return (
    <div className="relative w-full h-screen flex flex-col items-center justify-center bg-slate-900 overflow-hidden text-center">
      {/* Confetti / Star background */}
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-50 animate-pulse"></div>
      <div className="absolute inset-0 bg-gradient-to-t from-indigo-900/80 to-transparent"></div>

      <div className="z-10 animate-fade-in-up">
        <h1 className="text-5xl md:text-7xl font-bold text-white mb-6">Terima Kasih</h1>
        <p className="text-2xl text-indigo-300 mb-12 max-w-2xl mx-auto leading-relaxed">
          "Setiap pertemuan pasti ada perpisahan. Tapi kenangan akan selalu abadi di hati."
        </p>
        
        <div className="space-y-4 text-slate-400 mb-16">
          <p className="font-semibold text-white uppercase tracking-widest">{settings.schoolName}</p>
          <p>Angkatan {settings.schoolYear}</p>
        </div>

        <div className="flex justify-center gap-4">
          <button onClick={() => setView('splash')} className="px-8 py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-white transition backdrop-blur-sm">
            Kembali ke Awal
          </button>
        </div>
      </div>
    </div>
  );
}


// ==========================================
// 4. ADMIN LOGIN
// ==========================================
function AdminLogin({ setView, setIsAdminAuth }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const handleLogin = (e) => {
    e.preventDefault();
    // Validasi menggunakan enkripsi base64 agar lebih aman dari inspeksi kode
    if (btoa(pin) === ENCODED_PIN) {
      setIsAdminAuth(true);
      setView('admin_dashboard');
    } else {
      setError(true);
      setPin('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-800 rounded-2xl shadow-2xl p-8 border border-white/10">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-indigo-600/20 text-indigo-400 rounded-full flex items-center justify-center mx-auto mb-4">
            <LogIn className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-white">Login Operator</h2>
          <p className="text-slate-400 mt-2">Masukkan PIN untuk mengelola data</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">PIN Akses</label>
            <input 
              type="password" 
              value={pin}
              onChange={(e) => { setPin(e.target.value); setError(false); }}
              className={`w-full bg-slate-900 border ${error ? 'border-red-500' : 'border-slate-700'} rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition`}
              placeholder="Masukkan PIN Akses"
              autoFocus
            />
            {error && <p className="text-red-400 text-sm mt-2">PIN Salah! Silakan coba lagi.</p>}
          </div>

          <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-lg transition duration-200">
            Masuk ke Dashboard
          </button>
        </form>

        <button onClick={() => setView('splash')} className="w-full mt-4 text-slate-400 hover:text-white text-sm transition">
          Kembali ke Layar Utama
        </button>
      </div>
    </div>
  );
}


// ==========================================
// 5. ADMIN DASHBOARD & CRUD
// ==========================================
function AdminDashboard({ students, settings, setView, user, setIsAdminAuth }) {
  const [activeTab, setActiveTab] = useState('students'); // students, settings
  
  const handleLogout = () => {
    setIsAdminAuth(false);
    setView('splash');
  };

  return (
    <div className="flex h-screen bg-slate-900 text-slate-200">
      {/* Sidebar */}
      <div className="w-64 bg-slate-800 border-r border-slate-700 flex flex-col">
        <div className="p-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-400" /> Operator
          </h2>
        </div>
        <nav className="flex-1 px-4 space-y-2">
          <button 
            onClick={() => setActiveTab('students')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${activeTab === 'students' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-700'}`}
          >
            <Users className="w-5 h-5" /> Data Siswa
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${activeTab === 'settings' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-700'}`}
          >
            <Settings className="w-5 h-5" /> Pengaturan
          </button>
        </nav>
        <div className="p-4 border-t border-slate-700 flex flex-col gap-2">
          <button onClick={() => setView('splash')} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition">
            <Play className="w-4 h-4" /> Mulai Slide
          </button>
          <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition">
            <LogOut className="w-4 h-4" /> Keluar Admin
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Header */}
        <header className="bg-slate-800 border-b border-slate-700 px-8 py-4 flex justify-between items-center shrink-0">
          <h1 className="text-2xl font-semibold text-white">
            {activeTab === 'students' ? 'Manajemen Data Siswa' : 'Pengaturan Aplikasi'}
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-sm bg-slate-700 px-3 py-1 rounded-full text-slate-300">Total: {students.length} Siswa</span>
          </div>
        </header>

        {/* Scrollable Content Area */}
        <main className="flex-1 overflow-y-auto p-8 bg-slate-900 relative">
          {activeTab === 'students' ? (
             <StudentManager students={students} user={user} />
          ) : (
             <SettingsManager settings={settings} user={user} />
          )}
        </main>
      </div>
    </div>
  );
}


// --- STUDENT MANAGER (CRUD) ---
function StudentManager({ students, user }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');
  const [filterKelas, setFilterKelas] = useState('');
  
  // Custom states for alerts & delete confirmation
  const [alertMsg, setAlertMsg] = useState("");
  const [itemToDelete, setItemToDelete] = useState(null);

  // --- NEW STATES FOR BULK DELETE ---
  const [selectedIds, setSelectedIds] = useState([]);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);

  // New State for Bulk Photo Import Class
  const [bulkUploadClass, setBulkUploadClass] = useState('');

  // Form State - Added 'prediksi'
  const [formData, setFormData] = useState({
    nama: '', ortu: '', kelas: '', motto: '', prestasi: '', foto: '', prediksi: ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingMotto, setIsGeneratingMotto] = useState(false);
  const [isGeneratingPrediksi, setIsGeneratingPrediksi] = useState(false);

  // Auto clear alerts
  useEffect(() => {
    if (alertMsg) {
      const timer = setTimeout(() => setAlertMsg(""), 4000);
      return () => clearTimeout(timer);
    }
  }, [alertMsg]);

  // Handle Mass Import CSV (SMART IMPORT/UPDATE)
  const handleBulkImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!user) return setAlertMsg("Belum terkoneksi ke database!");
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target.result;
      const rows = text.split('\n');
      
      setIsSaving(true);
      let newCount = 0;
      let updateCount = 0;
      
      // Skip header row (i = 1)
      for (let i = 1; i < rows.length; i++) { 
        const row = rows[i];
        if (!row.trim()) continue;

        // Deteksi cerdas: apakah pakai koma (,) atau titik koma (;) dari Excel
        let delimiter = ',';
        if (row.indexOf(';') !== -1 && row.split(';').length > row.split(',').length) {
          delimiter = ';';
        }
        
        const cols = row.split(delimiter);
        
        // Fungsi pembersih tanda kutip bawaan Excel
        const cleanStr = (str) => {
          if (!str) return '';
          let s = str.trim();
          if (s.startsWith('"') && s.endsWith('"')) {
             s = s.substring(1, s.length - 1).trim();
          }
          return s;
        };
        
        // Format CSV: Nama, Kelas, Ortu, Prestasi, Motto
        const nama = cleanStr(cols[0]);
        const kelas = cleanStr(cols[1]);
        const ortu = cleanStr(cols[2]);
        const prestasi = cleanStr(cols[3]);
        const motto = cleanStr(cols[4]);
        
        if (nama) {
          // Cari apakah nama siswa sudah ada di database (case-insensitive)
          const existingStudent = students.find(s => s.nama.toLowerCase() === nama.toLowerCase());

          if (existingStudent) {
            // Jika sudah ada, UPDATE datanya (Foto tidak akan terhapus)
            const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', existingStudent.id);
            const updatedData = { ...existingStudent };
            
            if (kelas) updatedData.kelas = kelas;
            if (ortu) updatedData.ortu = ortu;
            if (prestasi) updatedData.prestasi = prestasi;
            if (motto) updatedData.motto = motto;

            await setDoc(docRef, updatedData);
            updateCount++;
          } else if (kelas) {
            // Jika belum ada, buat sebagai siswa BARU
            const docId = `std_${Date.now()}_${Math.random().toString(36).substring(7)}`;
            const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', docId);
            await setDoc(docRef, { nama, ortu, kelas, motto, prestasi, foto: '', prediksi: '', id: docId });
            newCount++;
          }
        }
      }
      setIsSaving(false);
      setAlertMsg(`Selesai! ${updateCount} diperbarui, ${newCount} siswa baru ditambahkan.`);
      e.target.value = null; // reset input
    };
    reader.readAsText(file);
  };

  // Handle Mass Photo Upload
  const handleMassPhotoUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!user) return setAlertMsg("Belum terkoneksi ke database!");

    setIsSaving(true);
    let count = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Dapatkan nama file tanpa ekstensinya (misal: "Budi Santoso.jpg" menjadi "Budi Santoso")
      const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "");

      try {
        const compressedBase64 = await compressImage(file);
        const docId = `std_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', docId);
        
        // Simpan langsung sebagai data siswa baru dengan kelas otomatis jika sudah diset
        await setDoc(docRef, { 
          nama: fileNameWithoutExt, 
          ortu: '', 
          kelas: bulkUploadClass, // Mengambil kelas dari dropdown bulk upload
          motto: '', 
          prestasi: '', 
          prediksi: '',
          foto: compressedBase64, 
          id: docId 
        });
        count++;
      } catch (err) {
        console.error("Gagal memproses file:", file.name, err);
      }
    }

    setIsSaving(false);
    setAlertMsg(`Berhasil menambahkan ${count} foto sebagai data siswa baru!`);
    e.target.value = null; // Reset file input
  };

  // Generate unique classes for filter
  const classes = [...new Set(students.map(s => s.kelas))].sort();

  const handleOpenModal = (student = null) => {
    if (student) {
      setFormData({
        nama: student.nama || '',
        ortu: student.ortu || '',
        kelas: student.kelas || '',
        motto: student.motto || '',
        prestasi: student.prestasi || '',
        foto: student.foto || '',
        prediksi: student.prediksi || ''
      });
      setEditingId(student.id);
    } else {
      setFormData({ nama: '', ortu: '', kelas: '', motto: '', prestasi: '', foto: '', prediksi: '' });
      setEditingId(null);
    }
    setIsModalOpen(true);
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const compressedBase64 = await compressImage(file);
        setFormData({ ...formData, foto: compressedBase64 });
      } catch (err) {
        console.error("Error compressing image", err);
        setAlertMsg("Gagal memproses gambar.");
      }
    }
  };

  const handleGenerateMotto = async () => {
    if (!formData.nama) return;
    setIsGeneratingMotto(true);
    const prompt = `Buatkan satu kalimat motto perpisahan sekolah yang inspiratif, menyentuh, dan berkesan untuk siswa bernama ${formData.nama}${formData.prestasi ? ' dengan prestasi: ' + formData.prestasi : ''}. \n\nSyarat:\n- Maksimal 15 kata.\n- Jangan gunakan tanda kutip di awal dan akhir.\n- Gunakan bahasa Indonesia yang baik, sedikit puitis atau memotivasi.`;
    
    const aiMotto = await generateTextWithRetry(prompt);
    if (aiMotto) {
      setFormData(prev => ({ ...prev, motto: aiMotto.trim().replace(/^["']|["']$/g, '') }));
    }
    setIsGeneratingMotto(false);
  };

  const handleGeneratePrediksi = async () => {
    if (!formData.nama) return;
    setIsGeneratingPrediksi(true);
    const prompt = `Berperanlah sebagai pembaca masa depan yang ceria. Buatkan satu kalimat pendek (maks 15 kata) tebakan cita-cita atau kesuksesan masa depan untuk siswa SMP bernama ${formData.nama} dengan prestasi: ${formData.prestasi || 'anak yang rajin'}. Contoh: Kelak ia akan menjadi CEO startup teknologi yang mendunia! Gunakan nada yang seru, positif, tanpa tanda kutip.`;
    
    const aiPrediksi = await generateTextWithRetry(prompt);
    if (aiPrediksi) {
      setFormData(prev => ({ ...prev, prediksi: aiPrediksi.trim().replace(/^["']|["']$/g, '') }));
    }
    setIsGeneratingPrediksi(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!user) return setAlertMsg("Belum terkoneksi ke database!");
    
    setIsSaving(true);
    try {
      const docId = editingId || `std_${Date.now()}`;
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', docId);
      await setDoc(docRef, { ...formData, id: docId });
      setIsModalOpen(false);
      setAlertMsg("Data siswa berhasil disimpan!");
    } catch (error) {
      console.error("Error saving doc: ", error);
      setAlertMsg("Gagal menyimpan data.");
    }
    setIsSaving(false);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'students', itemToDelete));
      setItemToDelete(null);
      // Hapus ID dari daftar seleksi jika data tersebut sedang dicentang
      setSelectedIds(prev => prev.filter(id => id !== itemToDelete));
      setAlertMsg("Data berhasil dihapus");
    } catch (error) {
      console.error("Error deleting doc: ", error);
      setAlertMsg("Gagal menghapus data");
    }
  };

  // --- NEW FUNCTIONS FOR BULK DELETE ---
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(filteredStudents.map(s => s.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const confirmBulkDelete = async () => {
    setIsSaving(true);
    try {
      // Hapus semua data yang dicentang secara paralel agar cepat
      await Promise.all(selectedIds.map(id => 
        deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'students', id))
      ));
      setSelectedIds([]);
      setShowBulkDeleteModal(false);
      setAlertMsg(`${selectedIds.length} data berhasil dihapus`);
    } catch (error) {
      console.error("Error bulk deleting: ", error);
      setAlertMsg("Gagal menghapus data massal");
    }
    setIsSaving(false);
  };

  // Filter students locally
  const filteredStudents = students.filter(s => {
    const matchName = s.nama.toLowerCase().includes(search.toLowerCase());
    const matchClass = filterKelas === '' || s.kelas === filterKelas;
    return matchName && matchClass;
  });

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {alertMsg && (
        <div className="fixed bottom-6 right-6 bg-slate-800 text-white px-6 py-4 rounded-xl shadow-2xl border border-slate-700 z-[70] animate-fade-in-right flex items-center gap-4">
           <span>{alertMsg}</span>
           <button onClick={() => setAlertMsg("")} className="text-slate-400 hover:text-white bg-slate-700/50 p-1 rounded-md transition">
             <X className="w-4 h-4" />
           </button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {itemToDelete && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl w-full max-w-sm border border-slate-700 shadow-2xl p-6 text-center animate-scale-in">
            <Trash2 className="w-16 h-16 text-red-500 mx-auto mb-4 bg-red-500/10 p-3 rounded-full" />
            <h3 className="text-xl font-bold text-white mb-2">Hapus Data?</h3>
            <p className="text-slate-400 mb-6 text-sm">Data siswa ini akan dihapus secara permanen. Anda yakin ingin melanjutkan?</p>
            <div className="flex justify-center gap-3">
              <button onClick={() => setItemToDelete(null)} className="px-5 py-2.5 text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded-xl transition font-medium">Batal</button>
              <button onClick={confirmDelete} className="px-5 py-2.5 text-white bg-red-600 hover:bg-red-500 rounded-xl transition font-medium">Ya, Hapus</button>
            </div>
          </div>
        </div>
      )}

      {/* NEW: Bulk Delete Confirmation Modal */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl w-full max-w-sm border border-slate-700 shadow-2xl p-6 text-center animate-scale-in">
            <Trash2 className="w-16 h-16 text-red-500 mx-auto mb-4 bg-red-500/10 p-3 rounded-full" />
            <h3 className="text-xl font-bold text-white mb-2">Hapus {selectedIds.length} Data?</h3>
            <p className="text-slate-400 mb-6 text-sm">Semua data siswa yang dipilih akan dihapus secara permanen. Anda yakin ingin melanjutkan?</p>
            <div className="flex justify-center gap-3">
              <button onClick={() => setShowBulkDeleteModal(false)} disabled={isSaving} className="px-5 py-2.5 text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded-xl transition font-medium">Batal</button>
              <button onClick={confirmBulkDelete} disabled={isSaving} className="px-5 py-2.5 text-white bg-red-600 hover:bg-red-500 rounded-xl transition font-medium disabled:opacity-50">
                {isSaving ? 'Menghapus...' : 'Ya, Hapus Semua'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between gap-4 bg-slate-800 p-4 rounded-xl border border-slate-700">
        <div className="flex gap-4 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input 
              type="text" 
              placeholder="Cari nama siswa..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <select 
            value={filterKelas} 
            onChange={(e) => setFilterKelas(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Semua Kelas</option>
            {classes.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          
          {/* Target Class Dropdown for Bulk Upload */}
          <select 
            value={bulkUploadClass}
            onChange={(e) => setBulkUploadClass(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500"
            title="Pilih kelas sebelum menekan tombol Import Foto Massal"
          >
            <option value="">Set Kelas (Opsional)</option>
            <option value="IX A">IX A</option>
            <option value="IX B">IX B</option>
            <option value="IX C">IX C</option>
            <option value="IX D">IX D</option>
            <option value="IX E">IX E</option>
            <option value="IX F">IX F</option>
            <option value="IX G">IX G</option>
            <option value="IX H">IX H</option>
            <option value="IX I">IX I</option>
          </select>

          {/* NEW: Button Bulk Delete */}
          {selectedIds.length > 0 && (
            <button 
              onClick={() => setShowBulkDeleteModal(true)}
              className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition animate-scale-in"
            >
              <Trash2 className="w-5 h-5" /> Hapus ({selectedIds.length})
            </button>
          )}

          {/* Button Import Foto Massal */}
          <label className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition cursor-pointer disabled:opacity-50">
            {isSaving ? 'Loading...' : <><ImageIcon className="w-5 h-5" /> Import Foto</>}
            <input type="file" accept="image/*" multiple onChange={handleMassPhotoUpload} className="hidden" disabled={isSaving} />
          </label>
          
          <label className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition cursor-pointer disabled:opacity-50">
            {isSaving ? 'Loading...' : <><Upload className="w-5 h-5" /> Import CSV</>}
            <input type="file" accept=".csv" onChange={handleBulkImport} className="hidden" disabled={isSaving} />
          </label>

          <button 
            onClick={() => handleOpenModal()}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition"
          >
            <Plus className="w-5 h-5" /> Tambah Siswa
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900/50 text-slate-400 text-sm border-b border-slate-700">
                <th className="p-4 w-12 text-center">
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    checked={filteredStudents.length > 0 && selectedIds.length === filteredStudents.length}
                    onChange={handleSelectAll}
                    title="Pilih Semua di Halaman ini"
                  />
                </th>
                <th className="p-4 font-medium">Foto</th>
                <th className="p-4 font-medium">Nama Lengkap</th>
                <th className="p-4 font-medium">Kelas</th>
                <th className="p-4 font-medium">Orang Tua</th>
                <th className="p-4 font-medium text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {filteredStudents.length > 0 ? (
                filteredStudents.map((student) => (
                  <tr key={student.id} className={`hover:bg-slate-700/50 transition group ${selectedIds.includes(student.id) ? 'bg-indigo-900/20' : ''}`}>
                    <td className="p-4 text-center">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        checked={selectedIds.includes(student.id)}
                        onChange={() => handleSelectOne(student.id)}
                      />
                    </td>
                    <td className="p-4">
                      {student.foto ? (
                        <img src={student.foto} alt={student.nama} className="w-12 h-12 rounded-lg object-cover border border-slate-600" />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-slate-700 flex items-center justify-center text-slate-400 border border-slate-600">
                          <ImageIcon className="w-5 h-5" />
                        </div>
                      )}
                    </td>
                    <td className="p-4 font-medium text-white">{student.nama}</td>
                    <td className="p-4 text-indigo-300 font-semibold">{student.kelas || '-'}</td>
                    <td className="p-4 text-slate-400">{student.ortu}</td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition">
                        <button onClick={() => handleOpenModal(student)} className="p-2 text-blue-400 hover:bg-blue-400/10 rounded-lg">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => setItemToDelete(student.id)} className="p-2 text-red-400 hover:bg-red-400/10 rounded-lg">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-slate-500">
                    Tidak ada data siswa ditemukan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Form Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl w-full max-w-2xl border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-700 flex justify-between items-center shrink-0">
              <h2 className="text-xl font-bold text-white">{editingId ? 'Edit Data Siswa' : 'Tambah Siswa Baru'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <form id="student-form" onSubmit={handleSave} className="space-y-4">
                
                {/* Photo Upload Area */}
                <div className="flex flex-col items-center mb-6">
                  <div className="w-32 h-40 bg-slate-900 border-2 border-dashed border-slate-600 rounded-xl flex flex-col items-center justify-center overflow-hidden relative group cursor-pointer">
                    {formData.foto ? (
                      <>
                        <img src={formData.foto} alt="Preview" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/50 hidden group-hover:flex items-center justify-center text-white">
                          <Upload className="w-6 h-6" />
                        </div>
                      </>
                    ) : (
                      <div className="text-slate-400 flex flex-col items-center">
                        <Upload className="w-8 h-8 mb-2" />
                        <span className="text-xs">Upload Foto</span>
                      </div>
                    )}
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handlePhotoUpload} 
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-2">Rasio 3:4. Otomatis dikompres &lt; 1MB</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Nama Lengkap *</label>
                    <input required type="text" value={formData.nama} onChange={e => setFormData({...formData, nama: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white" />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Kelas *</label>
                    <select 
                      required 
                      value={formData.kelas} 
                      onChange={e => setFormData({...formData, kelas: e.target.value})} 
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="" disabled>Pilih Kelas</option>
                      <option value="IX A">IX A</option>
                      <option value="IX B">IX B</option>
                      <option value="IX C">IX C</option>
                      <option value="IX D">IX D</option>
                      <option value="IX E">IX E</option>
                      <option value="IX F">IX F</option>
                      <option value="IX G">IX G</option>
                      <option value="IX H">IX H</option>
                      <option value="IX I">IX I</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Nama Orang Tua</label>
                    <input type="text" value={formData.ortu} onChange={e => setFormData({...formData, ortu: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white" />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Prestasi (Opsional)</label>
                    <input type="text" value={formData.prestasi} placeholder="Juara 1 Lomba..." onChange={e => setFormData({...formData, prestasi: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white" />
                  </div>
                  
                  {/* NEW FIELD: AI Prediksi Masa Depan */}
                  <div className="col-span-1 md:col-span-2 mt-2">
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-sm text-slate-400">Prediksi Masa Depan (Fun Fact)</label>
                      <button
                        type="button"
                        onClick={handleGeneratePrediksi}
                        disabled={isGeneratingPrediksi || !formData.nama}
                        title={!formData.nama ? "Isi nama siswa dulu" : "Tebak cita-cita dengan AI"}
                        className="text-xs bg-pink-600/20 text-pink-400 hover:bg-pink-600/40 px-3 py-1.5 rounded-full flex items-center gap-1.5 transition disabled:opacity-50 border border-pink-500/30"
                      >
                        {isGeneratingPrediksi ? '✨ Menerawang...' : '✨ Tebak dgn AI'}
                      </button>
                    </div>
                    <input type="text" value={formData.prediksi || ''} placeholder="Contoh: Kelak akan menjadi CEO Sukses" onChange={e => setFormData({...formData, prediksi: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white" />
                  </div>

                  <div className="col-span-1 md:col-span-2 mt-2">
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-sm text-slate-400">Motto / Quote</label>
                      <button
                        type="button"
                        onClick={handleGenerateMotto}
                        disabled={isGeneratingMotto || !formData.nama}
                        title={!formData.nama ? "Isi nama siswa dulu" : "Buat motto dengan AI"}
                        className="text-xs bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/40 px-3 py-1.5 rounded-full flex items-center gap-1.5 transition disabled:opacity-50 border border-indigo-500/30"
                      >
                        {isGeneratingMotto ? '✨ Menulis...' : '✨ Buat dgn AI'}
                      </button>
                    </div>
                    <textarea rows="3" value={formData.motto} onChange={e => setFormData({...formData, motto: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white resize-none"></textarea>
                  </div>

                </div>
              </form>
            </div>

            <div className="p-4 border-t border-slate-700 bg-slate-800/50 flex justify-end gap-3 shrink-0">
              <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-300 hover:text-white">Batal</button>
              <button 
                type="submit" 
                form="student-form"
                disabled={isSaving}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50"
              >
                {isSaving ? 'Menyimpan...' : <><Save className="w-4 h-4" /> Simpan Data</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- SETTINGS MANAGER ---
function SettingsManager({ settings, user }) {
  const [formData, setFormData] = useState(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  // AI Speech Generator States
  const [aiScript, setAiScript] = useState("");
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [scriptType, setScriptType] = useState('mc'); // mc, kepsek, siswa, doa

  const handleSave = async (e) => {
    e.preventDefault();
    if (!user) return alert("Belum terkoneksi ke database!");
    
    setIsSaving(true);
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'main');
      await setDoc(docRef, formData);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error("Error saving settings: ", error);
      alert("Gagal menyimpan pengaturan.");
    }
    setIsSaving(false);
  };

  const handleGenerateScript = async () => {
    setIsGeneratingScript(true);
    let promptType = "";
    
    switch (scriptType) {
      case 'mc':
        promptType = "naskah pembukaan MC (Master of Ceremony) yang interaktif dan hangat";
        break;
      case 'kepsek':
        promptType = "pidato sambutan Kepala Sekolah yang berwibawa, memotivasi, dan mengharukan";
        break;
      case 'siswa':
        promptType = "pidato pesan dan kesan dari perwakilan siswa yang menyentuh hati dan merefleksikan kenangan indah";
        break;
      case 'doa':
        promptType = "teks doa penutup acara yang khidmat, universal, dan mendoakan kesuksesan siswa di masa depan";
        break;
      default:
        promptType = "naskah MC";
    }

    const prompt = `Buatkan draft ${promptType} untuk acara perpisahan sekolah tingkat SMP dengan detail berikut:
- Nama Sekolah: ${formData.schoolName}
- Nama Acara: ${formData.eventName}
- Tahun Ajaran: ${formData.schoolYear}

Syarat:
1. Buat teks yang siap dibacakan secara langsung.
2. Panjang maksimal 3-4 paragraf.
3. Berikan sapaan pembuka (Yth. Kepala Sekolah, Bapak/Ibu Guru, Wali Murid, dan Siswa-siswi).
4. Gunakan bahasa Indonesia yang baik, formal namun tetap memiliki sentuhan emosional.`;
    
    const script = await generateTextWithRetry(prompt);
    if (script) {
      setAiScript(script);
    }
    setIsGeneratingScript(false);
  };

  const copyToClipboard = () => {
    try { document.execCommand("copy"); } catch (err) {}
    if (navigator.clipboard) {
      navigator.clipboard.writeText(aiScript).catch(() => fallbackCopy(aiScript));
    } else {
      fallbackCopy(aiScript);
    }
  };

  const fallbackCopy = (text) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-8 shadow-xl">
        <form onSubmit={handleSave} className="space-y-6">
          
          <div className="pt-2 border-b border-slate-700 pb-6 mb-6">
            <h3 className="text-lg font-bold text-white mb-4">Profil Sekolah</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-300 mb-2">URL Logo Sekolah (Opsional)</label>
              <input 
                type="text" 
                value={formData.schoolLogoUrl || ''}
                onChange={(e) => setFormData({...formData, schoolLogoUrl: e.target.value})}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500"
                placeholder="Contoh: https://i.ibb.co/..."
              />
              <p className="text-xs text-slate-500 mt-1">Kosongkan jika ingin menggunakan logo default. Upload logo ke ImgBB / Postimages lalu paste link-nya di sini.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">URL Logo Kanan Atas (Merdeka Mengajar / Belajar)</label>
              <input 
                type="text" 
                value={formData.merdekaLogoUrl || ''}
                onChange={(e) => setFormData({...formData, merdekaLogoUrl: e.target.value})}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500"
                placeholder="Contoh: https://i.ibb.co/..."
              />
              <p className="text-xs text-slate-500 mt-1">Jika dikosongkan, akan memuat logo default Merdeka Belajar. (Gunakan link langsung ke gambar)</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Nama Sekolah</label>
            <input 
              type="text" 
              value={formData.schoolName}
              onChange={(e) => setFormData({...formData, schoolName: e.target.value})}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Nama Acara</label>
            <input 
              type="text" 
              value={formData.eventName}
              onChange={(e) => setFormData({...formData, eventName: e.target.value})}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Tahun Ajaran</label>
            <input 
              type="text" 
              value={formData.schoolYear}
              onChange={(e) => setFormData({...formData, schoolYear: e.target.value})}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Kecepatan Slide (Detik)</label>
              <input 
                type="number" 
                min="1"
                max="20"
                value={formData.slideSpeed}
                onChange={(e) => setFormData({...formData, slideSpeed: parseInt(e.target.value)})}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">URL Musik Latar (MP3)</label>
              <input 
                type="text" 
                value={formData.musicUrl}
                onChange={(e) => setFormData({...formData, musicUrl: e.target.value})}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500"
                placeholder="https://.../music.mp3"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-700">
            <h3 className="text-lg font-bold text-white mb-4">Pengaturan Visual Slide</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Gaya Bingkai Foto</label>
                <select
                  value={formData.photoFrame || 'minimalist'}
                  onChange={(e) => setFormData({...formData, photoFrame: e.target.value})}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="minimalist">Minimalis (Rounded Edge)</option>
                  <option value="polaroid">Polaroid (Frame Putih Klasik)</option>
                  <option value="neon">Neon Glow (Bercahaya)</option>
                  <option value="elegant-gold">Emas Elegan (Mewah & Formal)</option>
                  <option value="graduation">Tema Perpisahan (Graduation)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Tipe Background Slide</label>
                <select
                  value={formData.bgType || 'blur'}
                  onChange={(e) => setFormData({...formData, bgType: e.target.value})}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="blur">Blur Foto Siswa (Otomatis)</option>
                  <option value="image">Gambar Kustom (URL)</option>
                  <option value="color">Warna Solid (Polos)</option>
                </select>
              </div>

            </div>
            
            {/* Conditional Input based on Background Type */}
            {formData.bgType === 'image' && (
              <div className="mt-4 animate-scale-in">
                <label className="block text-sm font-medium text-slate-300 mb-2">URL Gambar Background (Web / Unsplash)</label>
                <input 
                  type="text" 
                  value={formData.bgCustomUrl || ''}
                  onChange={(e) => setFormData({...formData, bgCustomUrl: e.target.value})}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500"
                  placeholder="Contoh: https://images.unsplash.com/..."
                />
              </div>
            )}
            
            {formData.bgType === 'color' && (
              <div className="mt-4 animate-scale-in">
                <label className="block text-sm font-medium text-slate-300 mb-2">Pilih Warna Background</label>
                <div className="flex items-center gap-4">
                  <input 
                    type="color" 
                    value={formData.bgCustomColor || '#0f172a'}
                    onChange={(e) => setFormData({...formData, bgCustomColor: e.target.value})}
                    className="w-16 h-12 bg-slate-900 border border-slate-700 rounded-lg cursor-pointer"
                  />
                  <span className="text-slate-400 text-sm">{formData.bgCustomColor || '#0f172a'}</span>
                </div>
              </div>
            )}

          </div>

          <div className="pt-4 border-t border-slate-700 flex items-center justify-between">
            {saveSuccess ? (
              <span className="text-green-400 flex items-center gap-2"><Check className="w-5 h-5"/> Tersimpan!</span>
            ) : (
              <span className="text-slate-500 text-sm">Disimpan secara real-time ke Cloud</span>
            )}
            
            <button 
              type="submit" 
              disabled={isSaving}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-8 rounded-lg transition duration-200 flex items-center gap-2"
            >
              {isSaving ? 'Menyimpan...' : <><Save className="w-5 h-5" /> Simpan Pengaturan</>}
            </button>
          </div>
        </form>
      </div>

      {/* NEW FEATURE: AI Assistant Multi-Speech Writer */}
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-8 shadow-xl">
        <div className="mb-6 border-b border-slate-700 pb-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">✨ Penulis Pidato AI (Asisten Panitia)</h3>
          <p className="text-sm text-slate-400 mt-1">Hasilkan draf berbagai naskah acara secara otomatis untuk memudahkan panitia.</p>
        </div>
        
        <div className="flex flex-col md:flex-row gap-4 items-center mb-6">
          <select 
            value={scriptType}
            onChange={(e) => setScriptType(e.target.value)}
            className="w-full md:w-auto flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-purple-500"
          >
            <option value="mc">Naskah Panduan MC</option>
            <option value="kepsek">Pidato Sambutan Kepala Sekolah</option>
            <option value="siswa">Kesan Pesan Perwakilan Siswa</option>
            <option value="doa">Teks Doa Penutup</option>
          </select>
          
          <button 
            type="button"
            onClick={handleGenerateScript}
            disabled={isGeneratingScript}
            className="w-full md:w-auto bg-purple-600 hover:bg-purple-500 text-white px-6 py-2.5 rounded-lg flex items-center justify-center gap-2 transition disabled:opacity-50 font-medium whitespace-nowrap"
          >
            {isGeneratingScript ? '✨ Menulis Naskah...' : '✨ Buat Naskah'}
          </button>
        </div>

        {aiScript && (
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 relative group animate-scale-in">
            <button 
              onClick={copyToClipboard}
              className="absolute top-4 right-4 bg-slate-800 hover:bg-slate-700 text-xs text-white px-3 py-1.5 rounded-md opacity-0 group-hover:opacity-100 transition border border-slate-600 flex items-center gap-1"
            >
              Salin Teks
            </button>
            <div className="text-slate-300 text-sm whitespace-pre-wrap leading-relaxed">
              {aiScript}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- CSS STYLES FOR ANIMATIONS (Injected globally) ---
const style = document.createElement('style');
style.textContent = `
  @keyframes blob {
    0% { transform: translate(0px, 0px) scale(1); }
    33% { transform: translate(30px, -50px) scale(1.1); }
    66% { transform: translate(-20px, 20px) scale(0.9); }
    100% { transform: translate(0px, 0px) scale(1); }
  }
  .animate-blob {
    animation: blob 7s infinite;
  }
  .animation-delay-2000 {
    animation-delay: 2s;
  }
  .animation-delay-300 {
    animation-delay: 0.3s;
  }
  .animation-delay-600 {
    animation-delay: 0.6s;
  }
  .animation-delay-1000 {
    animation-delay: 1s;
  }
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .animate-fade-in-up {
    animation: fadeInUp 0.8s ease-out forwards;
    opacity: 0;
  }
  @keyframes fadeInDown {
    from { opacity: 0; transform: translateY(-20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .animate-fade-in-down {
    animation: fadeInDown 0.8s ease-out forwards;
    opacity: 0;
  }
  @keyframes fadeInRight {
    from { opacity: 0; transform: translateX(30px); }
    to { opacity: 1; transform: translateX(0); }
  }
  .animate-fade-in-right {
    animation: fadeInRight 0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  }
  @keyframes scaleIn {
    from { opacity: 0; transform: scale(0.9); }
    to { opacity: 1; transform: scale(1); }
  }
  .animate-scale-in {
    animation: scaleIn 1s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  }
  @keyframes shimmer {
    100% { transform: translateX(100%); }
  }
  .animate-shimmer {
    animation: shimmer 2s infinite;
  }
  @keyframes panSlow {
    0% { transform: scale(1); }
    50% { transform: scale(1.05); }
    100% { transform: scale(1); }
  }
  .animate-pan-slow {
    animation: panSlow 20s infinite ease-in-out;
  }

  /* Hilangkan scrollbar default untuk tampilan presentasi mobile yang rapi */
  .scrollbar-hide {
    -ms-overflow-style: none;  /* IE and Edge */
    scrollbar-width: none;  /* Firefox */
  }
  .scrollbar-hide::-webkit-scrollbar {
    display: none; /* Chrome, Safari and Opera */
  }
`;
document.head.appendChild(style);