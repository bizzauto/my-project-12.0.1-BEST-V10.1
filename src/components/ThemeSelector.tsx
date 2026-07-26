import React, { useState, useEffect } from 'react';
import { Palette, Check, X, RotateCcw, Sparkles } from 'lucide-react';
import { themes, applyTheme, getThemeById, getStoredTheme, setStoredTheme, Theme } from '../lib/themes';
import { useDesignVariant, DesignVariant } from '../contexts/DesignVariantContext';

interface ThemeSelectorProps {
  onClose?: () => void;
}

const ThemeSelector: React.FC<ThemeSelectorProps> = ({ onClose }) => {
  const [selectedTheme, setSelectedTheme] = useState<string>(getStoredTheme());
  const [isOpen, setIsOpen] = useState(false);
  const [previewTheme, setPreviewTheme] = useState<string | null>(null);

  useEffect(() => {
    const savedTheme = getStoredTheme();
    setSelectedTheme(savedTheme);
    applyTheme(getThemeById(savedTheme));
  }, []);

  const handleSelectTheme = (themeId: string) => {
    setSelectedTheme(themeId);
    applyTheme(getThemeById(themeId));
    setStoredTheme(themeId);
  };

  const handlePreview = (themeId: string) => {
    setPreviewTheme(themeId);
    applyTheme(getThemeById(themeId));
  };

  const handleCancelPreview = () => {
    if (previewTheme) {
      applyTheme(getThemeById(selectedTheme));
      setPreviewTheme(null);
    }
  };

  const handleReset = () => {
    handleSelectTheme('default');
  };

  return (
    <>
      {/* Theme Toggle Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-24 right-6 z-40 p-3 bg-blue-600 text-white rounded-full shadow-lg hover:shadow-xl hover:scale-110 transition-all duration-300 group md:bottom-6"
        title="Change Theme"
      >
        <Palette size={24} className="group-hover:rotate-180 transition-transform duration-500" />
        <span className="absolute right-14 top-1/2 -translate-y-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
          Change Theme
        </span>
      </button>

      {/* Theme Selector Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => { setIsOpen(false); handleCancelPreview(); }}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 px-4 sm:px-5 md:px-6 py-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-600 rounded-lg">
                  <Palette size={20} className="text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Choose Theme</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Select a color scheme for your dashboard</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleReset}
                  className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  title="Reset to default"
                >
                  <RotateCcw size={18} />
                </button>
                <button
                  onClick={() => { setIsOpen(false); handleCancelPreview(); }}
                  className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Theme Grid */}
            <div className="p-4 sm:p-5 md:p-6 overflow-y-auto max-h-[calc(85vh-80px)]">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {themes.map((theme) => (
                  <ThemeCard
                    key={theme.id}
                    theme={theme}
                    isSelected={selectedTheme === theme.id}
                    isPreviewing={previewTheme === theme.id}
                    onSelect={() => handleSelectTheme(theme.id)}
                    onPreview={() => handlePreview(theme.id)}
                  />
                ))}
              </div>

              {/* Design Variant Toggle */}
              <div className="mt-6 mb-2">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={16} className="text-purple-500" />
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Design Style</h3>
                  <span className="text-[10px] bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300 px-1.5 py-0.5 rounded-full font-medium">NEW</span>
                </div>
                <DesignVariantToggle />
              </div>

              {/* Info */}
              <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
                <p className="text-sm text-blue-700 dark:text-blue-400">
                  <strong>Tip:</strong> Click on a theme to preview it. Your selection is saved automatically and will persist across sessions.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

interface ThemeCardProps {
  theme: Theme;
  isSelected: boolean;
  isPreviewing: boolean;
  onSelect: () => void;
  onPreview: () => void;
}

const ThemeCard: React.FC<ThemeCardProps> = ({ theme, isSelected, isPreviewing, onSelect, onPreview }) => {
  const { colors } = theme;

  return (
    <div
      className={`relative group cursor-pointer rounded-xl overflow-hidden transition-all duration-300 ${
        isSelected
          ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-800 ring-blue-500 scale-105'
          : 'hover:scale-102 hover:shadow-lg'
      }`}
      onClick={onSelect}
      onMouseEnter={onPreview}
    >
      {/* Color Preview */}
      <div
        className="h-24 relative"
        style={{
          background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 50%, ${colors.accent} 100%)`,
        }}
      >
        {/* Selected Check */}
        {isSelected && (
          <div className="absolute top-2 right-2 w-6 h-6 bg-white rounded-full flex items-center justify-center shadow-lg">
            <Check size={14} className="text-green-600" />
          </div>
        )}

        {/* Mini UI Preview */}
        <div className="absolute bottom-2 left-2 right-2 flex gap-1">
          <div className="h-2 w-8 rounded" style={{ backgroundColor: colors.bgPrimary + '80' }} />
          <div className="h-2 w-6 rounded" style={{ backgroundColor: colors.bgSecondary + '80' }} />
          <div className="h-2 w-4 rounded" style={{ backgroundColor: colors.accent + '80' }} />
        </div>
      </div>

      {/* Theme Info */}
      <div className="p-3 bg-white dark:bg-gray-800">
        <h4 className="font-medium text-gray-900 dark:text-white text-sm">{theme.name}</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{theme.description}</p>

        {/* Color Dots */}
        <div className="flex gap-1.5 mt-2">
          {[colors.primary, colors.secondary, colors.accent].map((color, i) => (
            <div
              key={i}
              className="w-4 h-4 rounded-full border border-gray-200 dark:border-gray-600"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

/* ── Design Variant Toggle ── */
function DesignVariantToggle() {
  const { variant, setVariant } = useDesignVariant();

  const options: { id: DesignVariant; label: string; desc: string }[] = [
    { id: 'default', label: 'Original', desc: 'Classic dark sidebar & layout' },
    { id: 'premium', label: 'Premium', desc: 'Glass sidebar, refined animations' },
  ];

  return (
    <div className="space-y-2">
      <div className="flex gap-2 p-1 bg-gray-100 dark:bg-gray-700/50 rounded-xl">
        {options.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setVariant(opt.id)}
            className={`flex-1 flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
              variant === opt.id
                ? 'bg-white dark:bg-gray-800 shadow-sm text-gray-900 dark:text-white ring-1 ring-gray-200 dark:ring-gray-600'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <span className="text-sm font-semibold">{opt.label}</span>
            <span className="text-[10px] opacity-70">{opt.desc}</span>
          </button>
        ))}
      </div>
      {variant === 'premium' && (
        <p className="text-[11px] text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
          <Sparkles size={12} />
          Premium style active — glass sidebar, rounded nav, smoother hover effects
        </p>
      )}
    </div>
  );
}

export default ThemeSelector;