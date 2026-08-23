import {
  PreOrderAiInput,
  PreOrderAiDecision,
  PostMortemAiInput,
  PostMortemAiResult,
  WeeklyStatsInput,
  WeeklyDigestResult
} from '../../models/ai-feedback.entity';

export interface AiAdvisorPort {
  evaluatePreOrder(input: PreOrderAiInput): Promise<PreOrderAiDecision>;
  analyzeTradePostMortem(input: PostMortemAiInput): Promise<PostMortemAiResult>;
  generateWeeklyDigest(input: WeeklyStatsInput): Promise<WeeklyDigestResult>;
}
