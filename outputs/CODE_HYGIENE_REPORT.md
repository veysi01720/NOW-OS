# Code Hygiene Report

Generated: 2026-08-13T23:32:51.738Z

This is a heuristic review aid. It does not delete code and every finding requires owner review before removal.

## Dead or Unreferenced Candidates

- src/bridge/answerPlan.ts
- src/bridge/bundleBuilder/bundleBuilder.ts
- src/reliability/postgresQueueSchema.ts
- src/reliability/publishSnapshot.ts
- src/reliability/queueWorker.ts

Why suspicious: no static import/reference from another source file.
Before removal: check dynamic imports, compose entrypoints, scripts, reflection, and deployment packaging.

## Low-Reference Functions

- src/behavior/canaryExecutionGate.ts:buildGateInputFromRuntime
- src/bridge/answerPlan.ts:buildAnswerPlan
- src/bridge/knowledgeBundle.ts:writeKnowledgeBundleAndManifest
- src/intelligence/conversation/ConversationDecisionEngine.ts:buildWorkModelAcceptanceFastPathDecision
- src/intelligence/conversation/ConversationDecisionEngine.ts:buildPhoneTypeCaptureFastPathDecision
- src/modelAdapter/responsesModelQualification.ts:qualifyConfiguredResponsesModel
- src/reliability/postgresQueueSchema.ts:pickupSql
- src/reliability/publishSnapshot.ts:buildDryRunRollbackPointer
- src/reliability/queueMonitoring.ts:emitQueueInfraAlerts
- src/reliability/queueWorker.ts:processInboundJob
- src/reliability/queueWorker.ts:processOutboundJob
- src/reliability/queueWorker.ts:processInboundJobDryRun
- src/reliability/queueWorker.ts:processOutboundJobDryRun
- src/store/trainingHandoffStore.ts:createTrainingActivationRef

Why suspicious: declaration was found without another static source reference.
Before removal: check public exports, runtime dependency injection, tests, and string-based dispatch.

## Overlapping Guard/Validator Surface

- src/intelligence/conversation/ConversationDecisionRepair.ts:selectRepeatSafeFallbackReply
- src/intelligence/conversation/ConversationDecisionRepair.ts:buildJobDefinitionSafetyDecision
- src/intelligence/conversation/ConversationDecisionRepair.ts:buildPaymentBoundarySafetyDecision
- src/intelligence/conversation/ConversationDecisionRepair.ts:buildCameraAccountBoundarySafetyDecision
- src/intelligence/conversation/ConversationDecisionRepair.ts:buildPartialIntakeSafetyDecision
- src/intelligence/conversation/ConversationDecisionRepair.ts:buildDeterministicSafetyDecision
- src/intelligence/conversation/ConversationValidatorReasonCatalog.ts:classifyValidatorReasonCode
- src/intelligence/conversation/ConversationValidatorReasonCatalog.ts:splitValidatorReasonCodes
- src/intelligence/quality/SemanticQualityGuard.ts:isEarlyStageRepeatRisk

Why suspicious: multiple guard/fallback/validator-like components exist and may enforce adjacent contracts.
Before removal: compare reason-code ownership, ordering, fail-closed behavior, and security history.

## Exported Functions Without Nearby Test References

- src/behavior/behaviorCanaryObservation.ts:createBehaviorCanaryExecutionId
- src/behavior/behaviorCanaryObservation.ts:roleCategory
- src/behavior/behaviorCanaryObservation.ts:planSnapshotFromQuality
- src/behavior/canaryExecutionGate.ts:buildGateInputFromRuntime
- src/bridge/answerPlan.ts:getCanonicalAppFacts
- src/bridge/answerPlan.ts:buildAnswerPlan
- src/bridge/approvedAppGuard.ts:checkApprovedAppVocabulary
- src/bridge/candidateIntakeStateMachine.ts:deriveCandidateState
- src/bridge/candidateIntakeStateMachine.ts:detectApprovedApp
- src/bridge/candidateIntakeStateMachine.ts:detectPhoneType
- src/bridge/candidateIntakeStateMachine.ts:detectModelAcceptance
- src/bridge/candidateIntakeStateMachine.ts:isAgeEligible
- src/bridge/candidateIntakeStateMachine.ts:detectPreviousPlatformExperience
- src/bridge/candidateIntakeStateMachine.ts:detectAgeGenderDailyHours
- src/bridge/followUpQueue.ts:normalizeText
- src/bridge/knowledgeBundle.ts:fullBundlePath
- src/bridge/knowledgeBundle.ts:publishManifestPath
- src/bridge/knowledgeBundle.ts:buildKnowledgeBundleContent
- src/bridge/knowledgeBundle.ts:writeKnowledgeBundleAndManifest
- src/bridge/knowledgePublish.ts:appendKnowledgePublishAudit
- src/bridge/knowledgeSync.ts:detectKnowledgeSyncIntent
- src/bridge/knowledgeSync.ts:isApprovedKnowledgeSyncCommand
- src/bridge/knowledgeSync.ts:validateKnowledgeBankTargetSafety
- src/bridge/knowledgeSync.ts:buildKnowledgePatchFromSuggestion
- src/bridge/knowledgeSync.ts:writeKnowledgeBankTarget
- src/bridge/knowledgeSync.ts:handleSyncActions
- src/bridge/learningReview.ts:detectLearningReviewIntent
- src/bridge/learningReview.ts:buildLearningReviewContext
- src/bridge/modeRouter.ts:detectCommandPrefix
- src/bridge/modeRouter.ts:routeCoreMode
- src/bridge/openaiFileSearchPublisher.ts:attachFileToVectorStore
- src/bridge/openaiFileSearchPublisher.ts:waitForVectorStoreFileCompleted
- src/bridge/openaiFileSearchPublisher.ts:uploadKnowledgeFile
- src/bridge/openaiInstallationVisionClassifier.ts:createOpenAIInstallationVisionClassifier
- src/bridge/reviewPublishDryRun.ts:validateOfficialSourceGate
- src/bridge/reviewPublishDryRun.ts:relativeOutputPath
- src/bridge/structuredAppFacts.ts:appFactsStructuredPath
- src/bridge/structuredAppFacts.ts:loadStructuredAppFacts
- src/bridge/zipIngestion/detection.ts:isZipAttachment
- src/bridge/zipIngestion/detection.ts:isUnsupportedArchive
- src/bridge/zipIngestion/detection.ts:hasZipPrefix
- src/bridge/zipIngestion/detection.ts:detectZipRouting
- src/bridge/zipIngestion/mediaDownloader.ts:downloadEvolutionMedia
- src/bridge/zipIngestion/pipeline.ts:loadZipLimitsFromEnv
- src/config/roles.ts:normalizePhoneNumber
- src/connectors/normalizeLayer.ts:generateSafeRef
- src/intelligence/candidate/StatePatchValidator.ts:validateAndApplyStatePatch
- src/intelligence/conversation/AllowedActionResolver.ts:resolveAllowedActions
- src/intelligence/conversation/ConversationContextBuilder.ts:buildConversationDecisionContext
- src/intelligence/conversation/ConversationDecisionEngine.ts:executeConversationDecisionV2
- src/intelligence/conversation/ConversationDecisionRepair.ts:buildPartialIntakeSafetyDecision
- src/intelligence/conversation/ConversationDecisionRepair.ts:buildCandidateToneBoundaryDecision
- src/intelligence/conversation/ConversationDecisionValidator.ts:parseConversationDecision
- src/intelligence/quality/SemanticQualityGuard.ts:validateSemanticQuality
- src/modelAdapter/modelAdapterCanaryStateStore.ts:emptyModelAdapterCanaryPersistentState
- src/modelAdapter/modelAdapterCanaryThresholds.ts:emptyModelAdapterCanaryObservation
- src/modelAdapter/modelExecutionErrors.ts:normalizeModelExecutionError
- src/modelAdapter/modelExecutionService.ts:buildRawErrorDiagnosticFields
- src/modelAdapter/ResponsesAdapter.ts:createOpenAIResponsesAdapter
- src/modelAdapter/responsesModelQualification.ts:qualifyConfiguredResponsesModel
- src/observability/correlation.ts:createCorrelationId
- src/observability/evolutionSessionIntegrity.ts:createEvolutionSessionIntegrityCheck
- src/reliability/postgresQueueSchema.ts:pickupSql
- src/reliability/publishSnapshot.ts:buildDryRunRollbackPointer
- src/reliability/queueMonitoring.ts:emitQueueInfraAlerts
- src/reliability/queueWorker.ts:processInboundJob
- src/reliability/queueWorker.ts:processOutboundJob
- src/reliability/queueWorker.ts:processInboundJobDryRun
- src/reliability/queueWorker.ts:processOutboundJobDryRun
- src/reliability/shadowQueue.ts:buildInboundQueueIdempotencyKey
- src/reliability/shadowQueue.ts:buildOutboundQueueIdempotencyKey
- src/reliability/shadowQueue.ts:enqueueOutboundShadow
- src/store/trainingHandoffStore.ts:createTrainingActivationRef
- src/utils/backupHelper.ts:getLatestBackupStatus
- src/utils/testPathGuard.ts:assertNonProductionKnowledgePathForTest
- src/utils/timezoneScheduler.ts:getSafeTimezone
- src/utils/whatsappLearningClassifier.ts:classifyWhatsAppMessage

Why suspicious: exported function name was not found in test sources.
Before removal or change: add focused coverage, especially for security, state, outbound, and persistence behavior.

## TODO/FIXME/Temporary Markers

- src/bridge/dashboardHtml.ts:458: <input type="text" id="wvr-local-path" class="form-control" style="margin-bottom:10px;" placeholder="C:/temp/chat.zip">
- src/bridge/whatsappVisualContextProcessor.ts:30: const mediaFiles = new Map<string, string>(); // filename -> safe temp path
- src/bridge/whatsappVisualContextProcessor.ts:315: console.warn("Failed to clean up temp dir:", tempDir, e);
- src/observability/connectionHealthMonitor.ts:292: const temp = `${this.logoutEventsPath}.tmp`;
- src/observability/connectionHealthMonitor.ts:293: writeFileSync(temp, JSON.stringify(this.logoutEvents), { mode: 0o600 });
- src/observability/connectionHealthMonitor.ts:294: renameSync(temp, this.logoutEventsPath);
- src/utils/testPathGuard.ts:12: throw new Error("Test attempted to use production data/knowledge_bank path. Use a temp KNOWLEDGE_BANK_DIR.");

Why suspicious: marker may represent unfinished or temporary behavior.
Before removal: link each marker to an issue or explicitly close it with evidence.
