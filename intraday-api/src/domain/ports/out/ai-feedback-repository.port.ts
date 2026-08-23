import {
  TradeFeedbackLesson,
  TradePostMortem,
  PreOrderAiDecision,
  WeeklyDigestReport
} from '../../models/ai-feedback.entity';

export interface AiFeedbackRepositoryPort {
  saveLesson(lesson: TradeFeedbackLesson): Promise<number>;
  findLessonsForContext(
    symbol: string,
    sector?: string,
    timeSlot?: string,
    limit?: number
  ): Promise<TradeFeedbackLesson[]>;
  incrementLessonUsage(lessonId: number): Promise<void>;
  
  savePostMortem(postMortem: TradePostMortem): Promise<number>;
  hasPostMortem(positionId: number): Promise<boolean>;
  getRecentPostMortems(limit?: number): Promise<TradePostMortem[]>;
  
  savePreOrderDecision(decision: PreOrderAiDecision): Promise<number>;
  
  saveWeeklyDigest(digest: WeeklyDigestReport): Promise<number>;
  getRecentWeeklyDigests(limit?: number): Promise<WeeklyDigestReport[]>;
}
