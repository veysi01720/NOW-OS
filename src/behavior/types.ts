import type { SenderRole } from "../config/roles.js";
import type { ChatType } from "../contracts/backendContextPayload.js";

export type UserStage =
  | "new"
  | "exploring"
  | "interested"
  | "hesitant"
  | "ready"
  | "active"
  | "needs_support"
  | "inactive"
  | "unknown";

export type UserIntent =
  | "question"
  | "hesitation"
  | "objection"
  | "ready_to_start"
  | "support_request"
  | "complaint"
  | "casual_message"
  | "unknown";

export type AssistantAction =
  | "none"
  | "ask_question"
  | "provide_guidance"
  | "encourage"
  | "escalate";

export type ResponseObjective =
  | "answer"
  | "clarify"
  | "reassure"
  | "guide"
  | "encourage"
  | "correct"
  | "escalate"
  | "ignore";

export type DesiredReplyLength = "very_short" | "short" | "medium";

export type ConversationalPrimaryIntent =
  | "direct_information"
  | "application_start"
  | "installation_help"
  | "installation_blocked"
  | "payment_question"
  | "earnings_question"
  | "work_method_question"
  | "trust_objection"
  | "safety_concern"
  | "identity_verification_question"
  | "application_selection"
  | "repeat_question"
  | "followup_question"
  | "confused_user"
  | "angry_user"
  | "irrelevant_message"
  | "manager_instruction"
  | "owner_training"
  | "handoff_required"
  | "unknown_intent";

export type ConversationalAnswerScope =
  | "direct_answer"
  | "answer_then_next_step"
  | "clarify"
  | "reassure"
  | "troubleshoot"
  | "escalate";

export type ConversationalTone = "natural" | "reassuring" | "instructional" | "firm" | "managerial";
export type ConversationalConfidence = "high" | "medium" | "low";

export interface ConversationContinuitySignals {
  factsAlreadyGiven: string[];
  stepsAlreadyCompleted: string[];
  userPreferencesKnown: string[];
  repeatedIntent: boolean;
  lastAssistantGoal?: string;
}

export interface ConversationalQualityContract {
  contractVersion: "1.0";
  primaryIntent: ConversationalPrimaryIntent;
  conversationStage: UserStage;
  responseGoal: string;
  answerScope: ConversationalAnswerScope;
  tone: ConversationalTone;
  lengthBudget: DesiredReplyLength;
  mustInclude: string[];
  mustAvoid: string[];
  askFollowup: boolean;
  followupPurpose?: string;
  useConversationHistory: boolean;
  avoidRepetition: boolean;
  escalationRequired: boolean;
  escalationReason?: string;
  confidence: ConversationalConfidence;
  continuitySignals: ConversationContinuitySignals;
}

export interface QualityValidationResult {
  ok: boolean;
  violations: string[];
}

export interface BehaviorProfile {
  tone: "natural_supportive";
  maxReplyLength: DesiredReplyLength;
  askOneQuestionAtATime: boolean;
  avoidRepeatingKnownInformation: boolean;
  useConversationHistory: boolean;
  allowFollowUpQuestion: boolean;
  allowPersuasion: boolean;
  prohibitedBehaviors: string[];
}

export interface ConversationState {
  tenantId: string;
  conversationId: string;
  channelType: ChatType;
  currentMode: string;
  userStage: UserStage;
  lastResolvedIntent: UserIntent | null;
  unresolvedObjections: string[];
  completedTopics: string[];
  pendingTopics: string[];
  lastAssistantAction: AssistantAction;
  lastUserSentiment: "neutral" | "positive" | "hesitant" | "frustrated" | "unknown";
  escalationStatus: "none" | "suggested" | "required" | "resolved";
  summary: string;
  textOnlyPreference: boolean;
  preferredWorkMode?: "text_only" | "video_or_voice_allowed";
  videoAllowed?: boolean;
  updatedAt: string;
}

export interface ResponsePlan {
  objective: ResponseObjective;
  desiredLength: DesiredReplyLength;
  mayAskQuestion: boolean;
  shouldUseKnowledge: boolean;
  shouldAcknowledgeEmotion: boolean;
  shouldAvoidRepetition: boolean;
  forbiddenTopics: string[];
  requiresModelCall: boolean;
  quality: ConversationalQualityContract;
}

export interface ResponsePlannerInput {
  channelType: ChatType;
  mode: string;
  senderRole: SenderRole;
  normalizedText: string;
  currentUserStage: UserStage;
  lastResolvedIntent: UserIntent | null;
  unresolvedObjections: string[];
  completedTopics: string[];
  pendingTopics: string[];
  isGroup: boolean;
  isAuthorized: boolean;
  answerPlan?: {
    mode?: string;
    intent?: string;
    escalation_required?: boolean;
    source_count?: number;
  };
}
