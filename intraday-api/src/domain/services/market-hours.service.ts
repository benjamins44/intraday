export interface MarketStatus {
  isOpen: boolean;
  isRegularTradingHours: boolean; // 09h30 - 16h00 EST
  isPreMarket: boolean;          // 04h00 - 09h30 EST
  isPastSquareOff: boolean;      // >= 15h45 EST
  estTimeString: string;
  dayOfWeek: number;             // 0 = Dimanche, 1 = Lundi, ..., 5 = Vendredi, 6 = Samedi
  reason?: string;
}

export class MarketHoursService {
  /**
   * Vérifie le statut exact du marché US (fuseau horaire America/New_York)
   */
  public static getMarketStatus(date = new Date()): MarketStatus {
    // Conversion en chaîne ISO heure de New York
    const estTimeStr = date.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const estDateStr = date.toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short'
    });

    // Détermination du jour (0 = Dimanche, 1 = Lundi, ..., 6 = Samedi)
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dayOfWeek = dayMap[estDateStr] ?? date.getDay();

    const [hour, minute] = estTimeStr.split(':').map(Number);
    const totalMinutes = hour * 60 + minute;

    const openMinutes = 9 * 60 + 30;   // 09h30 EST
    const squareOffMinutes = 15 * 60 + 45; // 15h45 EST
    const closeMinutes = 16 * 60;      // 16h00 EST
    const preMarketOpen = 4 * 60;      // 04h00 EST

    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    if (isWeekend) {
      return {
        isOpen: false,
        isRegularTradingHours: false,
        isPreMarket: false,
        isPastSquareOff: false,
        estTimeString: estTimeStr,
        dayOfWeek,
        reason: 'Marché fermé (Week-end)'
      };
    }

    const isRegularTradingHours = totalMinutes >= openMinutes && totalMinutes < closeMinutes;
    const isPreMarket = totalMinutes >= preMarketOpen && totalMinutes < openMinutes;
    const isPastSquareOff = totalMinutes >= squareOffMinutes && totalMinutes < closeMinutes;

    let reason = 'Marché ouvert (Séance régulière)';
    if (isPastSquareOff) reason = 'Phase de Square-Off (15h45-16h00 EST) : Fermeture des positions';
    else if (isPreMarket) reason = 'Pré-marché US (04h00-09h30 EST)';
    else if (totalMinutes >= closeMinutes || totalMinutes < preMarketOpen) reason = 'Marché fermé (Hors séance)';

    return {
      isOpen: isRegularTradingHours,
      isRegularTradingHours,
      isPreMarket,
      isPastSquareOff,
      estTimeString: estTimeStr,
      dayOfWeek,
      reason
    };
  }

  /**
   * Retourne le nombre de minutes écoulées depuis minuit à New York (EST/EDT)
   */
  public static getEstMinutes(date = new Date()): number {
    const estTimeStr = date.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });
    const [hour, minute] = estTimeStr.split(':').map(Number);
    return hour * 60 + minute;
  }
}
