import { Fragment, useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { useProjectStore } from '../stores/projectStore';
import { api, Dataset, DatasetItem, Evaluator, EvaluationExperiment, EvaluatorTemplate, ExperimentProgress, AutoEvalTask, ModelConfig, Prompt, ScheduledRun, ScheduledRunExecution, SamplingRule, AlertRuleV2, AlertEventV2 } from '../api';
import { useTranslation } from '../App';

type Tab = 'datasets' | 'evaluators' | 'experiments' | 'tasks' | 'schedules' | 'sampling' | 'alerts';

export function EvaluationPage() {
  const { currentProject, ensureDefaultProject } = useProjectStore();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('datasets');
  const [loading, setLoading] = useState(true);

  // Datasets state
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  const [datasetItems, setDatasetItems] = useState<DatasetItem[]>([]);
  const [showDatasetModal, setShowDatasetModal] = useState(false);
  const [showItemsModal, setShowItemsModal] = useState(false);
  const [datasetForm, setDatasetForm] = useState({ name: '', description: '', type: 'custom', auto_create_evaluators: false });
  const [itemInputs, setItemInputs] = useState([{ input: '', expected_output: '' }]);

  // Evaluators state
  const [evaluators, setEvaluators] = useState<Evaluator[]>([]);
  const [showEvaluatorModal, setShowEvaluatorModal] = useState(false);
  const [evaluatorForm, setEvaluatorForm] = useState({ name: '', type: 'exact_match', description: '', config: '{}' });

  // Experiments state
  const [experiments, setExperiments] = useState<EvaluationExperiment[]>([]);
  const [showExperimentModal, setShowExperimentModal] = useState(false);
  const [experimentForm, setExperimentForm] = useState({
    name: '',
    description: '',
    dataset_id: '',
    model_config_id: '',
    prompt_id: '',
    evaluator_id: '',
    temperature: '',
    max_tokens: '',
  });
  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [experimentReports, setExperimentReports] = useState<Record<string, any>>({});
  const [showReportModal, setShowReportModal] = useState<string | null>(null);
  const [badCases, setBadCases] = useState<Record<string, any[]>>({});
  const [calibratingResult, setCalibratingResult] = useState<string | null>(null);
  const [calibrationForm, setCalibrationForm] = useState({ score: 0, passed: false, note: '' });

  // Auto eval tasks state
  const [autoEvalTasks, setAutoEvalTasks] = useState<AutoEvalTask[]>([]);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskForm, setTaskForm] = useState({
    name: '', dataset_id: '', evaluator_id: '', interval_hours: 24, sample_count: 10, trace_type_filter: '', enabled: true,
  });
  const [experimentProgress, setExperimentProgress] = useState<Record<string, ExperimentProgress>>({});
  const [evaluatorTemplates, setEvaluatorTemplates] = useState<EvaluatorTemplate[]>([]);

  // Scheduled Run（PR-13a 定时回归）state
  const [schedules, setSchedules] = useState<ScheduledRun[]>([]);
  const [scheduleExecutions, setScheduleExecutions] = useState<Record<string, ScheduledRunExecution[]>>({});
  const [expandedScheduleId, setExpandedScheduleId] = useState<string | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    name: '',
    experiment_id: '',
    scheduleType: 'interval' as 'interval' | 'cron',
    intervalMinutes: 60,
    cronExpr: '0 9 * * 1-5',
  });

  // Trace Sampling（PR-13b 采样回流）state
  const [samplingRules, setSamplingRules] = useState<SamplingRule[]>([]);
  const [showSamplingModal, setShowSamplingModal] = useState(false);
  const [samplingForm, setSamplingForm] = useState({
    name: '',
    target_dataset_id: '',
    trace_type_filter: 'llm',
    name_contains: '',
    error_only: false,
    sample_rate: 1,
    max_items_total: '',
  });

  // Alert Rules（PR-13c 持久化告警）state
  const [alertRulesV2, setAlertRulesV2] = useState<AlertRuleV2[]>([]);
  const [alertEventsV2, setAlertEventsV2] = useState<AlertEventV2[]>([]);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [alertForm, setAlertForm] = useState({
    name: '',
    event_type: 'run_failed' as 'run_failed' | 'run_regression' | 'run_completed',
    threshold: 0.8,
    webhook_url: '',
    cooldown_minutes: 60,
  });

  useEffect(() => {
    ensureDefaultProject();
  }, [ensureDefaultProject]);

  const fetchDatasets = async () => {
    if (!currentProject) return;
    try {
      const res = await api.evaluation.datasets.list(currentProject.id);
      setDatasets(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Failed to fetch datasets:', e);
    }
  };

  const fetchModelConfigs = async () => {
    if (!currentProject) return;
    try {
      const res = await api.modelConfigs.list(currentProject.id);
      setModelConfigs(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Failed to fetch model configs:', e);
    }
  };

  /**
   * 加载项目下的 Prompt 列表，用于实验创建时选择被测 Prompt
   */
  const fetchPrompts = async () => {
    if (!currentProject) return;
    try {
      const res = await api.prompts.list(currentProject.id);
      setPrompts(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Failed to fetch prompts:', e);
    }
  };

  const fetchEvaluators = async () => {
    if (!currentProject) return;
    try {
      const res = await api.evaluation.evaluators.list(currentProject.id);
      setEvaluators(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Failed to fetch evaluators:', e);
    }
  };

  const fetchExperiments = async () => {
    if (!currentProject) return;
    try {
      const res = await api.evaluation.experiments.list(currentProject.id);
      setExperiments(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Failed to fetch experiments:', e);
    }
  };

  /**
   * 轮询实验状态直到进入终态
   * @param experimentId - 实验 ID
   * @returns 返回进入 completed 或 failed 终态后的实验对象
   */
  const pollExperimentUntilSettled = async (experimentId: string): Promise<EvaluationExperiment | null> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const experiment = await api.evaluation.experiments.get(experimentId);
      if (experiment.status === 'completed' || experiment.status === 'failed') {
        return experiment;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    return null;
  };

  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([fetchDatasets(), fetchEvaluators(), fetchExperiments(), fetchModelConfigs(), fetchPrompts()]);
    setLoading(false);
  };

  useEffect(() => {
    if (!currentProject) {
      setLoading(false);
      return;
    }
    fetchAll();
    fetchEvaluatorTemplates();
  }, [currentProject?.id]);

  // Dataset actions
  const handleCreateDataset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    try {
      const result = await api.evaluation.datasets.create({
        project_id: currentProject.id,
        name: datasetForm.name,
        description: datasetForm.description,
        type: datasetForm.type,
        auto_create_evaluators: datasetForm.auto_create_evaluators,
      });
      if (result.preset_evaluators && result.preset_evaluators.length > 0) {
        alert(t.autoEvaluatorsCreated.replace('{count}', String(result.preset_evaluators.length)));
      }
      setShowDatasetModal(false);
      setDatasetForm({ name: '', description: '', type: 'custom', auto_create_evaluators: false });
      fetchDatasets();
      fetchEvaluators();
    } catch (e) {
      console.error('Failed to create dataset:', e);
    }
  };

  const handleDeleteDataset = async (id: string) => {
    if (!confirm(t.deleteConfirm)) return;
    try {
      await api.evaluation.datasets.delete(id);
      if (selectedDataset?.id === id) setSelectedDataset(null);
      fetchDatasets();
    } catch (e) {
      console.error('Failed to delete dataset:', e);
    }
  };

  const handleSelectDataset = async (dataset: Dataset) => {
    setSelectedDataset(dataset);
    try {
      const items = await api.evaluation.datasets.items.list(dataset.id);
      setDatasetItems(Array.isArray(items) ? items : []);
    } catch (e) {
      console.error('Failed to fetch dataset items:', e);
    }
  };

  const handleAddItems = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDataset) return;
    try {
      const validItems = itemInputs.filter(i => i.input.trim());
      if (validItems.length === 0) return;
      await api.evaluation.datasets.items.add(selectedDataset.id, validItems);
      setShowItemsModal(false);
      setItemInputs([{ input: '', expected_output: '' }]);
      handleSelectDataset(selectedDataset);
      fetchDatasets();
    } catch (e) {
      console.error('Failed to add items:', e);
    }
  };

  // Evaluator actions
  const handleCreateEvaluator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    try {
      let config = {};
      try {
        config = JSON.parse(evaluatorForm.config);
      } catch {
        config = {};
      }
      await api.evaluation.evaluators.create({
        project_id: currentProject.id,
        name: evaluatorForm.name,
        type: evaluatorForm.type,
        description: evaluatorForm.description,
        config,
      });
      setShowEvaluatorModal(false);
      setEvaluatorForm({ name: '', type: 'exact_match', description: '', config: '{}' });
      fetchEvaluators();
    } catch (e) {
      console.error('Failed to create evaluator:', e);
    }
  };

  const handleDeleteEvaluator = async (id: string) => {
    if (!confirm(t.deleteConfirm)) return;
    try {
      await api.evaluation.evaluators.delete(id);
      fetchEvaluators();
    } catch (e) {
      console.error('Failed to delete evaluator:', e);
    }
  };

  // Experiment actions
  const handleCreateExperiment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    // 执行器必须通过 target_model_config_id 拿到含 API Key 的模型配置才能真正调用 LLM
    if (!experimentForm.model_config_id) {
      alert('请选择目标模型配置');
      return;
    }
    // Truth Repair-6: 实验必须绑定评估器，Runner 不再默认取项目第一个评估器
    if (!experimentForm.evaluator_id) {
      alert('请选择评估器');
      return;
    }
    try {
      const selectedConfig = modelConfigs.find(c => c.id === experimentForm.model_config_id);
      const selectedPrompt = prompts.find(p => p.id === experimentForm.prompt_id);
      // 组装 run_config：仅收集用户显式填写的数值，未填写则交由后端/Prompt 配置回退默认值
      const runConfig: Record<string, unknown> = {};
      if (experimentForm.temperature !== '') {
        const temperature = Number(experimentForm.temperature);
        if (!Number.isNaN(temperature)) runConfig.temperature = temperature;
      }
      if (experimentForm.max_tokens !== '') {
        const maxTokens = Number(experimentForm.max_tokens);
        if (!Number.isNaN(maxTokens)) runConfig.max_tokens = maxTokens;
      }
      await api.evaluation.experiments.create({
        project_id: currentProject.id,
        name: experimentForm.name,
        description: experimentForm.description,
        dataset_id: experimentForm.dataset_id,
        // Truth Repair-5: 提交执行器真正识别的 target_model_config_id（外键引用 model_configs.id）
        target_model_config_id: experimentForm.model_config_id,
        // Truth Repair-6: 提交实验绑定的评估器 ID，Runner 按此精确加载评估器
        evaluator_id: experimentForm.evaluator_id,
        // Prompt 作为可选被测对象：提交 prompt_id 及其当前版本 id，保证历史实验可按版本复现
        prompt_id: experimentForm.prompt_id || undefined,
        prompt_version_id: selectedPrompt?.current_version_id || undefined,
        // 运行参数（temperature / max_tokens 等）
        run_config: Object.keys(runConfig).length > 0 ? runConfig : undefined,
        // 保留 model_config 快照仅用于旧数据兼容展示；执行器以 target_model_config_id 为准
        model_config: selectedConfig ? {
          name: selectedConfig.name,
          provider: selectedConfig.provider,
          model: selectedConfig.model,
          base_url: selectedConfig.base_url,
          config: selectedConfig.config,
        } : undefined,
      });
      setShowExperimentModal(false);
      setExperimentForm({
        name: '', description: '', dataset_id: '', model_config_id: '',
        prompt_id: '', evaluator_id: '', temperature: '', max_tokens: '',
      });
      fetchExperiments();
    } catch (e) {
      console.error('Failed to create experiment:', e);
    }
  };

  const handleStartExperiment = async (id: string) => {
    try {
      await api.evaluation.experiments.start(id);
      await fetchExperiments();
      await pollExperimentUntilSettled(id);
      await fetchExperiments();
    } catch (e) {
      console.error('Failed to start experiment:', e);
    }
  };

  const handleDeleteExperiment = async (id: string) => {
    if (!confirm(t.deleteConfirm)) return;
    try {
      await api.evaluation.experiments.delete(id);
      fetchExperiments();
    } catch (e) {
      console.error('Failed to delete experiment:', e);
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending': return t.experimentStatusPending;
      case 'running': return t.experimentStatusRunning;
      case 'completed': return t.experimentStatusCompleted;
      case 'failed': return t.experimentStatusFailed;
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-gray-100 text-gray-700';
      case 'running': return 'bg-blue-100 text-blue-700';
      case 'completed': return 'bg-green-100 text-green-700';
      case 'failed': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100';
    }
  };

  const fetchAutoEvalTasks = async () => {
    if (!currentProject) return;
    try {
      const res = await api.evaluation.autoEvalTasks.list(currentProject.id);
      setAutoEvalTasks(res.tasks || []);
    } catch (e) {
      console.error('Failed to fetch auto eval tasks:', e);
    }
  };

  const handleCreateAutoEvalTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    try {
      await api.evaluation.autoEvalTasks.create({
        project_id: currentProject.id,
        name: taskForm.name,
        dataset_id: taskForm.dataset_id,
        evaluator_id: taskForm.evaluator_id || undefined,
        interval_hours: taskForm.interval_hours,
        sample_count: taskForm.sample_count,
        trace_type_filter: taskForm.trace_type_filter || undefined,
        enabled: taskForm.enabled,
      });
      setShowTaskModal(false);
      setTaskForm({ name: '', dataset_id: '', evaluator_id: '', interval_hours: 24, sample_count: 10, trace_type_filter: '', enabled: true });
      fetchAutoEvalTasks();
    } catch (e) {
      console.error('Failed to create auto eval task:', e);
    }
  };

  const handleDeleteAutoEvalTask = async (id: string) => {
    if (!confirm(t.autoEvalTaskDeleteConfirm)) return;
    try {
      await api.evaluation.autoEvalTasks.delete(id);
      fetchAutoEvalTasks();
    } catch (e) {
      console.error('Failed to delete auto eval task:', e);
    }
  };

  const handleTriggerAutoEvalTask = async (id: string) => {
    try {
      await api.evaluation.autoEvalTasks.trigger(id);
      alert(t.taskTriggered);
      fetchAutoEvalTasks();
    } catch (e) {
      console.error('Failed to trigger auto eval task:', e);
    }
  };

  /**
   * 拉取当前项目的 Scheduled Run 列表（PR-13a 定时回归）。
   */
  const fetchSchedules = async () => {
    if (!currentProject) return;
    try {
      const res = await api.schedules.list(currentProject.id);
      setSchedules(res.schedules || []);
    } catch (e) {
      console.error('Failed to fetch schedules:', e);
    }
  };

  /**
   * 拉取某条调度的执行历史。
   * @param scheduleId - 调度 ID
   * @param force - 是否强制刷新
   */
  const fetchScheduleExecutions = async (scheduleId: string, force = false) => {
    if (!currentProject) return;
    if (!force && scheduleExecutions[scheduleId]) return;
    try {
      const res = await api.schedules.executions(scheduleId, currentProject.id, 10);
      setScheduleExecutions((prev) => ({ ...prev, [scheduleId]: res.executions || [] }));
    } catch (e) {
      console.error('Failed to fetch schedule executions:', e);
    }
  };

  /**
   * 创建定时回归调度。interval 模式提交 intervalMinutes，cron 模式提交 cronExpr。
   * @param e - 表单事件
   */
  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    try {
      await api.schedules.create({
        projectId: currentProject.id,
        experimentId: scheduleForm.experiment_id,
        name: scheduleForm.name,
        scheduleType: scheduleForm.scheduleType,
        intervalMinutes: scheduleForm.scheduleType === 'interval' ? scheduleForm.intervalMinutes : undefined,
        cronExpr: scheduleForm.scheduleType === 'cron' ? scheduleForm.cronExpr : undefined,
      });
      setShowScheduleModal(false);
      setScheduleForm({ name: '', experiment_id: '', scheduleType: 'interval', intervalMinutes: 60, cronExpr: '0 9 * * 1-5' });
      fetchSchedules();
    } catch (err) {
      alert(err instanceof Error ? err.message : '创建调度失败');
    }
  };

  /**
   * 切换调度启用/禁用状态。
   * @param s - 目标调度
   */
  const handleToggleSchedule = async (s: ScheduledRun) => {
    try {
      await api.schedules.update(s.id, { projectId: s.project_id, enabled: !s.enabled });
      fetchSchedules();
    } catch (e) {
      console.error('Failed to toggle schedule:', e);
    }
  };

  /**
   * 删除调度。
   * @param s - 目标调度
   */
  const handleDeleteSchedule = async (s: ScheduledRun) => {
    if (!confirm(`确认删除定时调度「${s.name}」？`)) return;
    try {
      await api.schedules.remove(s.id, s.project_id);
      fetchSchedules();
    } catch (e) {
      console.error('Failed to delete schedule:', e);
    }
  };

  /**
   * 立即触发一次调度对应的 Run。
   * @param s - 目标调度
   */
  const handleRunNowSchedule = async (s: ScheduledRun) => {
    try {
      const res = await api.schedules.runNow(s.id, s.project_id);
      alert(`已触发 Run：${res.runId}`);
      await fetchSchedules();
      await fetchScheduleExecutions(s.id, true);
    } catch (err) {
      alert(err instanceof Error ? err.message : '触发失败');
    }
  };

  /**
   * 展开或收起调度执行历史。
   * @param scheduleId - 调度 ID
   */
  const handleToggleScheduleExecutions = async (scheduleId: string) => {
    if (expandedScheduleId === scheduleId) {
      setExpandedScheduleId(null);
      return;
    }
    setExpandedScheduleId(scheduleId);
    await fetchScheduleExecutions(scheduleId);
  };

  /**
   * 拉取 Trace 采样规则列表（PR-13b）。
   */
  const fetchSamplingRules = async () => {
    if (!currentProject) return;
    try {
      const res = await api.samplingRules.list(currentProject.id);
      setSamplingRules(res.rules || []);
    } catch (e) {
      console.error('Failed to fetch sampling rules:', e);
    }
  };

  /**
   * 创建采样规则。
   * @param e - 表单事件
   */
  const handleCreateSamplingRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    try {
      await api.samplingRules.create({
        projectId: currentProject.id,
        name: samplingForm.name,
        targetDatasetId: samplingForm.target_dataset_id,
        traceTypeFilter: samplingForm.trace_type_filter || undefined,
        nameContains: samplingForm.name_contains || undefined,
        errorOnly: samplingForm.error_only,
        sampleRate: samplingForm.sample_rate,
        maxItemsTotal: samplingForm.max_items_total ? Number(samplingForm.max_items_total) : undefined,
      });
      setShowSamplingModal(false);
      setSamplingForm({ name: '', target_dataset_id: '', trace_type_filter: 'llm', name_contains: '', error_only: false, sample_rate: 1, max_items_total: '' });
      fetchSamplingRules();
    } catch (err) {
      alert(err instanceof Error ? err.message : '创建规则失败');
    }
  };

  /**
   * 切换采样规则启用状态。
   * @param r - 目标规则
   */
  const handleToggleSamplingRule = async (r: SamplingRule) => {
    try {
      await api.samplingRules.update(r.id, { projectId: r.project_id, enabled: !r.enabled });
      fetchSamplingRules();
    } catch (e) {
      console.error('Failed to toggle sampling rule:', e);
    }
  };

  /**
   * 删除采样规则。
   * @param r - 目标规则
   */
  const handleDeleteSamplingRule = async (r: SamplingRule) => {
    if (!confirm(`确认删除采样规则「${r.name}」？`)) return;
    try {
      await api.samplingRules.remove(r.id, r.project_id);
      fetchSamplingRules();
    } catch (e) {
      console.error('Failed to delete sampling rule:', e);
    }
  };

  /**
   * 立即执行一轮采样回流。
   * @param r - 目标规则
   */
  const handleRunNowSampling = async (r: SamplingRule) => {
    try {
      const res = await api.samplingRules.runNow(r.id, r.project_id);
      alert(`本轮匹配 ${res.matched} 条，回流 ${res.sampled} 条`);
      fetchSamplingRules();
      fetchDatasets();
    } catch (err) {
      alert(err instanceof Error ? err.message : '采样失败');
    }
  };

  /**
   * 拉取持久化告警规则与最近事件（PR-13c）。
   */
  const fetchAlertRulesV2 = async () => {
    if (!currentProject) return;
    try {
      const [rulesRes, eventsRes] = await Promise.all([
        api.alertRulesV2.list(currentProject.id),
        api.alertRulesV2.events(currentProject.id, 20),
      ]);
      setAlertRulesV2(rulesRes.rules || []);
      setAlertEventsV2(eventsRes.events || []);
    } catch (e) {
      console.error('Failed to fetch alert rules:', e);
    }
  };

  /**
   * 创建告警规则。
   * @param e - 表单事件
   */
  const handleCreateAlertRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    try {
      await api.alertRulesV2.create({
        projectId: currentProject.id,
        name: alertForm.name,
        eventType: alertForm.event_type,
        threshold: alertForm.event_type === 'run_regression' ? alertForm.threshold : undefined,
        webhookUrl: alertForm.webhook_url || undefined,
        cooldownMinutes: alertForm.cooldown_minutes,
      });
      setShowAlertModal(false);
      setAlertForm({ name: '', event_type: 'run_failed', threshold: 0.8, webhook_url: '', cooldown_minutes: 60 });
      fetchAlertRulesV2();
    } catch (err) {
      alert(err instanceof Error ? err.message : '创建告警规则失败');
    }
  };

  /**
   * 切换告警规则启用状态。
   * @param r - 目标规则
   */
  const handleToggleAlertRule = async (r: AlertRuleV2) => {
    try {
      await api.alertRulesV2.update(r.id, { projectId: r.project_id, enabled: !r.enabled });
      fetchAlertRulesV2();
    } catch (e) {
      console.error('Failed to toggle alert rule:', e);
    }
  };

  /**
   * 删除告警规则。
   * @param r - 目标规则
   */
  const handleDeleteAlertRule = async (r: AlertRuleV2) => {
    if (!confirm(`确认删除告警规则「${r.name}」？`)) return;
    try {
      await api.alertRulesV2.remove(r.id, r.project_id);
      fetchAlertRulesV2();
    } catch (e) {
      console.error('Failed to delete alert rule:', e);
    }
  };

  const fetchExperimentReport = async (id: string) => {
    try {
      const report = await api.evaluation.experiments.report(id);
      setExperimentReports(prev => ({ ...prev, [id]: report }));
      setShowReportModal(id);
      fetchExperimentBadCases(id);
    } catch (e) {
      console.error('Failed to fetch experiment report:', e);
    }
  };

  const fetchExperimentBadCases = async (id: string) => {
    try {
      const res = await api.evaluation.experiments.badcases(id);
      setBadCases(prev => ({ ...prev, [id]: res.badcases || [] }));
    } catch (e) {
      console.error('Failed to fetch bad cases:', e);
    }
  };

  const handleCalibrateResult = async (resultId: string) => {
    try {
      await api.evaluation.results.calibrate(resultId, {
        calibrated_score: calibrationForm.score,
        calibrated_passed: calibrationForm.passed,
        calibration_note: calibrationForm.note,
      });
      if (showReportModal) {
        fetchExperimentReport(showReportModal);
        fetchExperimentBadCases(showReportModal);
      }
      setCalibratingResult(null);
      setCalibrationForm({ score: 0, passed: false, note: '' });
    } catch (e) {
      console.error('Failed to calibrate result:', e);
    }
  };

  const fetchExperimentProgress = async (id: string) => {
    try {
      const progress = await api.evaluation.experiments.progress(id);
      setExperimentProgress(prev => ({ ...prev, [id]: progress }));
    } catch (e) {
      console.error('Failed to fetch experiment progress:', e);
    }
  };

  const fetchEvaluatorTemplates = async () => {
    try {
      const res = await api.evaluation.evaluatorTemplates.list();
      setEvaluatorTemplates(res.templates || []);
    } catch (e) {
      console.error('Failed to fetch evaluator templates:', e);
    }
  };

  const handleDownloadScript = async (id: string, lang: 'typescript' | 'python') => {
    try {
      const template = await api.evaluation.experiments.scriptTemplate(id);
      const content = template[lang];
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `experiment-run-${id}.${lang === 'typescript' ? 'ts' : 'py'}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to download script:', e);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">{t.loading}</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t.evaluationCenter}</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b">
        {(['datasets', 'evaluators', 'experiments', 'tasks', 'schedules', 'sampling', 'alerts'] as Tab[]).map((tab) => (
          <button
            key={tab}
            data-testid={`${tab}-tab`}
            onClick={() => {
              setActiveTab(tab);
              setSelectedDataset(null);
              if (tab === 'tasks') fetchAutoEvalTasks();
              if (tab === 'schedules') {
                fetchSchedules();
                fetchExperiments();
              }
              if (tab === 'sampling') {
                fetchSamplingRules();
                fetchDatasets();
              }
              if (tab === 'alerts') fetchAlertRulesV2();
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'datasets' && t.datasets}
            {tab === 'evaluators' && t.evaluators}
            {tab === 'experiments' && t.experiments}
            {tab === 'tasks' && t.autoEvalTasks}
            {tab === 'schedules' && '定时调度'}
            {tab === 'sampling' && '采样回流'}
            {tab === 'alerts' && '告警规则'}
          </button>
        ))}
      </div>

      {/* Datasets Tab */}
      {activeTab === 'datasets' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-medium">{t.datasets}</h2>
            <button
              data-testid="create-dataset-btn"
              onClick={() => setShowDatasetModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              {t.createDataset}
            </button>
          </div>

          {selectedDataset ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setSelectedDataset(null)}
                  className="text-sm text-blue-600 hover:underline"
                >
                  ← {t.back}
                </button>
                <button
                  data-testid="add-items-btn"
                  onClick={() => setShowItemsModal(true)}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                >
                  {t.addItems}
                </button>
              </div>
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-medium text-lg">{selectedDataset.name}</h3>
                <p className="text-sm text-gray-500">{selectedDataset.description}</p>
                <p className="text-xs text-gray-400 mt-1">{t.itemCount}: {datasetItems.length}</p>
              </div>
              <div className="bg-white border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left">{t.itemInput}</th>
                      <th className="px-4 py-2 text-left">{t.itemExpectedOutput}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datasetItems.map((item) => (
                      <tr key={item.id} className="border-t">
                        <td className="px-4 py-2">{item.input}</td>
                        <td className="px-4 py-2">{item.expected_output || '-'}</td>
                      </tr>
                    ))}
                    {datasetItems.length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-4 py-8 text-center text-gray-500">{t.noData}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {datasets.map((dataset) => (
                <div
                  key={dataset.id}
                  data-testid={`dataset-card-${dataset.id}`}
                  onClick={() => handleSelectDataset(dataset)}
                  className="bg-white border rounded-lg p-4 cursor-pointer hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium">{dataset.name}</h3>
                    <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">{dataset.type}</span>
                  </div>
                  <p className="text-sm text-gray-500 line-clamp-2">{dataset.description}</p>
                  <div className="flex items-center justify-between mt-3 text-xs text-gray-400">
                    <span>{dataset.item_count} {t.items}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDataset(dataset.id);
                      }}
                      className="text-red-600 hover:underline"
                    >
                      {t.delete}
                    </button>
                  </div>
                </div>
              ))}
              {datasets.length === 0 && (
                <div className="col-span-full text-center text-gray-500 py-12 bg-white border rounded-lg">
                  {t.noDatasets}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Evaluators Tab */}
      {activeTab === 'evaluators' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-medium">{t.evaluators}</h2>
            <button
              data-testid="create-evaluator-btn"
              onClick={() => setShowEvaluatorModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              {t.createEvaluator}
            </button>
          </div>
          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left">{t.evaluatorName}</th>
                  <th className="px-4 py-2 text-left">{t.evaluatorType}</th>
                  <th className="px-4 py-2 text-left">{t.description}</th>
                  <th className="px-4 py-2 text-right">{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {evaluators.map((ev) => (
                  <tr key={ev.id} className="border-t">
                    <td className="px-4 py-2 font-medium">{ev.name}</td>
                    <td className="px-4 py-2">
                      <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded">{ev.type}</span>
                    </td>
                    <td className="px-4 py-2 text-gray-500">{ev.description || '-'}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => handleDeleteEvaluator(ev.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        {t.delete}
                      </button>
                    </td>
                  </tr>
                ))}
                {evaluators.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-500">{t.noEvaluators}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Experiments Tab */}
      {activeTab === 'experiments' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-medium">{t.experiments}</h2>
            <button
              data-testid="create-experiment-btn"
              onClick={() => setShowExperimentModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              {t.createExperiment}
            </button>
          </div>
          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left">{t.experimentName}</th>
                  <th className="px-4 py-2 text-left">{t.status}</th>
                  <th className="px-4 py-2 text-left">{t.dataset}</th>
                  <th className="px-4 py-2 text-right">{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {experiments.map((exp) => {
                  const progress = experimentProgress[exp.id];
                  return (
                    <tr key={exp.id} className="border-t">
                      <td className="px-4 py-2 font-medium">{exp.name}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${getStatusColor(exp.status)}`}>
                          {getStatusLabel(exp.status)}
                        </span>
                        {progress && progress.total_items > 0 && (
                          <div className="mt-1 text-xs text-gray-500">
                            {t.progress}: {progress.completed_items}/{progress.total_items} ({progress.completion_rate}%)
                          </div>
                        )}
                        {progress && progress.total_items > 0 && (
                          <div className="w-24 h-1.5 bg-gray-200 rounded mt-1">
                            <div
                              className="h-1.5 bg-blue-500 rounded"
                              style={{ width: `${progress.completion_rate}%` }}
                            />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-gray-500">
                        {datasets.find(d => d.id === exp.dataset_id)?.name || exp.dataset_id}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {exp.status === 'pending' && (
                            <button
                              data-testid="start-experiment-btn"
                              onClick={() => handleStartExperiment(exp.id)}
                              className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                            >
                              {t.startExperiment}
                            </button>
                          )}
                          <button
                            onClick={() => fetchExperimentProgress(exp.id)}
                            className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                            title={t.refreshProgress}
                          >
                            {t.progress}
                          </button>
                          <button
                            onClick={() => handleDownloadScript(exp.id, 'typescript')}
                            className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                            title={t.downloadTsScript}
                          >
                            TS
                          </button>
                          <button
                            onClick={() => handleDownloadScript(exp.id, 'python')}
                            className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                            title={t.downloadPyScript}
                          >
                            Py
                          </button>
                          <button
                            onClick={() => fetchExperimentReport(exp.id)}
                            className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200"
                            title={t.viewReport}
                          >
                            {t.viewReport}
                          </button>
                          <a
                            href={`/evaluation/runs/compare?experimentId=${exp.id}`}
                            className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
                            title="Run 对比 / 报告"
                          >
                            Run 对比
                          </a>
                          <button
                            onClick={() => handleDeleteExperiment(exp.id)}
                            className="text-xs text-red-600 hover:underline"
                          >
                            {t.delete}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {experiments.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-500">{t.noExperiments}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Auto Eval Tasks Tab */}
      {activeTab === 'tasks' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-medium">{t.autoEvalTasks}</h2>
            <button
              onClick={() => setShowTaskModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              {t.createTask}
            </button>
          </div>
          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left">{t.taskName}</th>
                  <th className="px-4 py-2 text-left">{t.interval}</th>
                  <th className="px-4 py-2 text-left">{t.sampleCount}</th>
                  <th className="px-4 py-2 text-left">{t.taskStatus}</th>
                  <th className="px-4 py-2 text-right">{t.taskOperations}</th>
                </tr>
              </thead>
              <tbody>
                {autoEvalTasks.map((task) => (
                  <tr key={task.id} className="border-t">
                    <td className="px-4 py-2 font-medium">{task.name}</td>
                    <td className="px-4 py-2">{task.interval_hours}h</td>
                    <td className="px-4 py-2">{task.sample_count}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${task.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                        {task.enabled ? t.enabled : t.disabled}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleTriggerAutoEvalTask(task.id)}
                          className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                        >
                          {t.trigger}
                        </button>
                        <button
                          onClick={() => handleDeleteAutoEvalTask(task.id)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          {t.delete}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {autoEvalTasks.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">{t.noAutoEvalTasks}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Scheduled Runs Tab（PR-13a 定时回归） */}
      {activeTab === 'schedules' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-lg font-medium">定时回归调度</h2>
              <p className="text-xs text-gray-500 mt-1">按固定间隔或 cron 表达式自动触发 Experiment Run，到期后由服务端 Worker 自动执行。</p>
            </div>
            <button
              data-testid="create-schedule-btn"
              onClick={() => setShowScheduleModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              新建调度
            </button>
          </div>
          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left">名称</th>
                  <th className="px-4 py-2 text-left">调度规则</th>
                  <th className="px-4 py-2 text-left">下次运行</th>
                  <th className="px-4 py-2 text-left">上次状态</th>
                  <th className="px-4 py-2 text-left">状态</th>
                  <th className="px-4 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <Fragment key={s.id}>
                    <tr key={s.id} className="border-t" data-testid={`schedule-row-${s.id}`}>
                      <td className="px-4 py-2 font-medium">
                        {s.name}
                        <div className="text-xs text-gray-400 font-normal">
                          {experiments.find((x) => x.id === s.experiment_id)?.name ?? s.experiment_id.slice(0, 8)}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-600">
                        {s.schedule_type === 'interval'
                          ? `每 ${s.interval_minutes} 分钟`
                          : <code className="bg-gray-100 px-1.5 py-0.5 rounded">{s.cron_expr}</code>}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-600">
                        {s.next_run_at ? new Date(s.next_run_at).toLocaleString('zh-CN') : '-'}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {s.last_status ? (
                          <span className={`px-2 py-0.5 rounded ${
                            s.last_status === 'created' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {s.last_status}
                            {s.last_run_id && (
                              <a href={`/evaluation/runs/${s.last_run_id}`} className="ml-1 underline">
                                Run
                              </a>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-400">未运行</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${s.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                          {s.enabled ? '已启用' : '已停用'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleToggleScheduleExecutions(s.id)}
                            className="text-xs px-2 py-1 bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
                          >
                            {expandedScheduleId === s.id ? '收起历史' : '执行历史'}
                          </button>
                          <button
                            onClick={() => handleRunNowSchedule(s)}
                            className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                          >
                            立即运行
                          </button>
                          <button
                            onClick={() => handleToggleSchedule(s)}
                            className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                          >
                            {s.enabled ? '停用' : '启用'}
                          </button>
                          <button
                            onClick={() => handleDeleteSchedule(s)}
                            className="text-xs text-red-600 hover:underline"
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedScheduleId === s.id && (
                      <tr className="border-t bg-gray-50">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="text-xs text-gray-500 mb-2">最近 10 次执行</div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-gray-500">
                                  <th className="py-1 pr-3">开始时间</th>
                                  <th className="py-1 pr-3">触发方式</th>
                                  <th className="py-1 pr-3">状态</th>
                                  <th className="py-1 pr-3">Run</th>
                                  <th className="py-1 pr-3">完成时间</th>
                                  <th className="py-1 pr-3">下次运行</th>
                                  <th className="py-1">错误</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(scheduleExecutions[s.id] || []).map((execution) => (
                                  <tr key={execution.id} className="border-t border-gray-200/80">
                                    <td className="py-2 pr-3">{new Date(execution.started_at).toLocaleString('zh-CN')}</td>
                                    <td className="py-2 pr-3">{execution.trigger_mode === 'manual' ? '立即运行' : '自动调度'}</td>
                                    <td className="py-2 pr-3">
                                      <span className={`px-2 py-0.5 rounded ${
                                        execution.status === 'created'
                                          ? 'bg-green-100 text-green-700'
                                          : execution.status === 'failed'
                                            ? 'bg-red-100 text-red-700'
                                            : 'bg-amber-100 text-amber-700'
                                      }`}>
                                        {execution.status}
                                      </span>
                                    </td>
                                    <td className="py-2 pr-3">
                                      {execution.run_id ? (
                                        <a href={`/evaluation/runs/${execution.run_id}`} className="text-blue-600 hover:underline">
                                          查看 Run
                                        </a>
                                      ) : (
                                        <span className="text-gray-400">-</span>
                                      )}
                                    </td>
                                    <td className="py-2 pr-3">
                                      {execution.completed_at ? new Date(execution.completed_at).toLocaleString('zh-CN') : '-'}
                                    </td>
                                    <td className="py-2 pr-3">
                                      {execution.next_run_at ? new Date(execution.next_run_at).toLocaleString('zh-CN') : '-'}
                                    </td>
                                    <td className="py-2 break-all text-red-600">{execution.error_message || '-'}</td>
                                  </tr>
                                ))}
                                {(scheduleExecutions[s.id] || []).length === 0 && (
                                  <tr>
                                    <td colSpan={7} className="py-4 text-center text-gray-400">
                                      暂无执行历史
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {schedules.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      暂无定时调度，点击「新建调度」创建第一条定时回归
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Scheduled Run 创建弹窗 */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <form onSubmit={handleCreateSchedule} className="bg-white rounded-lg p-6 w-full max-w-lg">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium">新建定时回归</h3>
              <button type="button" onClick={() => setShowScheduleModal(false)} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-700 mb-1">调度名称</label>
                <input
                  value={scheduleForm.name}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, name: e.target.value })}
                  required
                  className="w-full border rounded px-3 py-2 text-sm"
                  placeholder="如：每小时回归 / 工作日早间回归"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">Experiment</label>
                <select
                  value={scheduleForm.experiment_id}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, experiment_id: e.target.value })}
                  required
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  <option value="">请选择实验</option>
                  {experiments.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">调度方式</label>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={scheduleForm.scheduleType === 'interval'}
                      onChange={() => setScheduleForm({ ...scheduleForm, scheduleType: 'interval' })}
                    />
                    固定间隔
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={scheduleForm.scheduleType === 'cron'}
                      onChange={() => setScheduleForm({ ...scheduleForm, scheduleType: 'cron' })}
                    />
                    Cron 表达式
                  </label>
                </div>
              </div>
              {scheduleForm.scheduleType === 'interval' ? (
                <div>
                  <label className="block text-sm text-gray-700 mb-1">间隔（分钟）</label>
                  <input
                    type="number"
                    min={1}
                    value={scheduleForm.intervalMinutes}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, intervalMinutes: Number(e.target.value) })}
                    required
                    className="w-full border rounded px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-gray-400 mt-1">常用：60（每小时）、360（每 6 小时）、1440（每天）</p>
                </div>
              ) : (
                <div>
                  <label className="block text-sm text-gray-700 mb-1">Cron 表达式（分 时 日 月 周）</label>
                  <input
                    value={scheduleForm.cronExpr}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, cronExpr: e.target.value })}
                    required
                    className="w-full border rounded px-3 py-2 text-sm font-mono"
                    placeholder="0 9 * * 1-5"
                  />
                  <p className="text-xs text-gray-400 mt-1">示例：0 9 * * 1-5（工作日 9 点）、*/30 * * * *（每 30 分钟）</p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                className="px-4 py-2 text-sm border rounded hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                创建
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Trace Sampling Tab（PR-13b 采样回流） */}
      {activeTab === 'sampling' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-lg font-medium">线上 Trace 采样回流</h2>
              <p className="text-xs text-gray-500 mt-1">
                服务端每分钟自动扫描：按 Trace 类型/名称关键词/错误状态过滤，按采样率确定性抽样，回流到指定 Dataset 作为回归样本。
              </p>
            </div>
            <button
              data-testid="create-sampling-rule-btn"
              onClick={() => setShowSamplingModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              新建采样规则
            </button>
          </div>
          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left">规则名称</th>
                  <th className="px-4 py-2 text-left">目标数据集</th>
                  <th className="px-4 py-2 text-left">过滤条件</th>
                  <th className="px-4 py-2 text-left">采样率/上限</th>
                  <th className="px-4 py-2 text-left">已回流</th>
                  <th className="px-4 py-2 text-left">状态</th>
                  <th className="px-4 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {samplingRules.map((r) => (
                  <tr key={r.id} className="border-t" data-testid={`sampling-rule-row-${r.id}`}>
                    <td className="px-4 py-2 font-medium">{r.name}</td>
                    <td className="px-4 py-2 text-xs">
                      {datasets.find((d) => d.id === r.target_dataset_id)?.name ?? r.target_dataset_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600">
                      <div className="flex flex-wrap gap-1">
                        {r.trace_type_filter && (
                          <span className="px-1.5 py-0.5 bg-gray-100 rounded">type={r.trace_type_filter}</span>
                        )}
                        {r.name_contains && (
                          <span className="px-1.5 py-0.5 bg-gray-100 rounded">名称含「{r.name_contains}」</span>
                        )}
                        {r.status_filter && (
                          <span className="px-1.5 py-0.5 bg-gray-100 rounded">status={r.status_filter}</span>
                        )}
                        {r.error_only && (
                          <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded">仅错误</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600">
                      {Math.round(r.sample_rate * 100)}%
                      {r.max_items_total ? ` / 上限 ${r.max_items_total}` : ' / 无上限'}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <span className="font-medium text-blue-700">{r.sampled_count}</span>
                      <span className="text-gray-400"> / 匹配 {r.matched_count}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${r.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                        {r.enabled ? '已启用' : '已停用'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleRunNowSampling(r)}
                          className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                        >
                          立即采样
                        </button>
                        <button
                          onClick={() => handleToggleSamplingRule(r)}
                          className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                        >
                          {r.enabled ? '停用' : '启用'}
                        </button>
                        <button
                          onClick={() => handleDeleteSamplingRule(r)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {samplingRules.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      暂无采样规则，点击「新建采样规则」把线上 Trace 自动回流为评测样本
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Trace Sampling 创建弹窗 */}
      {showSamplingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <form onSubmit={handleCreateSamplingRule} className="bg-white rounded-lg p-6 w-full max-w-lg">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium">新建采样规则</h3>
              <button type="button" onClick={() => setShowSamplingModal(false)} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-700 mb-1">规则名称</label>
                <input
                  value={samplingForm.name}
                  onChange={(e) => setSamplingForm({ ...samplingForm, name: e.target.value })}
                  required
                  className="w-full border rounded px-3 py-2 text-sm"
                  placeholder="如：客服 Trace 10% 采样"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">回流目标数据集</label>
                <select
                  value={samplingForm.target_dataset_id}
                  onChange={(e) => setSamplingForm({ ...samplingForm, target_dataset_id: e.target.value })}
                  required
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  <option value="">请选择数据集</option>
                  {datasets.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-700 mb-1">Trace 类型（留空不限）</label>
                  <input
                    value={samplingForm.trace_type_filter}
                    onChange={(e) => setSamplingForm({ ...samplingForm, trace_type_filter: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm"
                    placeholder="llm / tool / ..."
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">名称包含关键词（留空不限）</label>
                  <input
                    value={samplingForm.name_contains}
                    onChange={(e) => setSamplingForm({ ...samplingForm, name_contains: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm"
                    placeholder="如：客服"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-700 mb-1">采样率（0~1）</label>
                  <input
                    type="number"
                    step={0.05}
                    min={0.01}
                    max={1}
                    value={samplingForm.sample_rate}
                    onChange={(e) => setSamplingForm({ ...samplingForm, sample_rate: Number(e.target.value) })}
                    required
                    className="w-full border rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">回流总量上限（留空不限）</label>
                  <input
                    type="number"
                    min={1}
                    value={samplingForm.max_items_total}
                    onChange={(e) => setSamplingForm({ ...samplingForm, max_items_total: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm"
                    placeholder="如 500"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={samplingForm.error_only}
                  onChange={(e) => setSamplingForm({ ...samplingForm, error_only: e.target.checked })}
                />
                仅采样错误 Trace（error 非空），用于构建 Bad Case 集
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => setShowSamplingModal(false)}
                className="px-4 py-2 text-sm border rounded hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                创建
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Alert Rules Tab（PR-13c 持久化告警） */}
      {activeTab === 'alerts' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-medium">评测告警规则</h2>
              <p className="text-xs text-gray-500 mt-1">
                Run 失败、通过率回归或完成时自动触发，可投递到 Webhook（飞书/Slack/钉钉等）；同一 Run 同规则只告警一次，并按冷却时间去重。
              </p>
            </div>
            <button
              data-testid="create-alert-rule-btn"
              onClick={() => setShowAlertModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              新建告警规则
            </button>
          </div>

          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left">规则名称</th>
                  <th className="px-4 py-2 text-left">触发事件</th>
                  <th className="px-4 py-2 text-left">阈值/Webhook</th>
                  <th className="px-4 py-2 text-left">冷却</th>
                  <th className="px-4 py-2 text-left">上次触发</th>
                  <th className="px-4 py-2 text-left">状态</th>
                  <th className="px-4 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {alertRulesV2.map((r) => (
                  <tr key={r.id} className="border-t" data-testid={`alert-rule-row-${r.id}`}>
                    <td className="px-4 py-2 font-medium">{r.name}</td>
                    <td className="px-4 py-2 text-xs">
                      <span className={`px-2 py-0.5 rounded ${
                        r.event_type === 'run_failed' ? 'bg-red-100 text-red-700'
                        : r.event_type === 'run_regression' ? 'bg-amber-100 text-amber-700'
                        : 'bg-blue-100 text-blue-700'
                      }`}>
                        {r.event_type === 'run_failed' && 'Run 失败'}
                        {r.event_type === 'run_regression' && '通过率回归'}
                        {r.event_type === 'run_completed' && 'Run 完成'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600">
                      {r.threshold !== null && <div>通过率 &lt; {Math.round(r.threshold * 100)}%</div>}
                      <div className="truncate max-w-[200px]" title={r.webhook_url ?? ''}>
                        {r.webhook_url ? <span className="text-green-700">Webhook 已配置</span> : <span className="text-gray-400">仅站内</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600">{r.cooldown_minutes} 分钟</td>
                    <td className="px-4 py-2 text-xs text-gray-600">
                      {r.last_triggered_at ? new Date(r.last_triggered_at).toLocaleString('zh-CN') : '-'}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${r.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                        {r.enabled ? '已启用' : '已停用'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleToggleAlertRule(r)}
                          className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                        >
                          {r.enabled ? '停用' : '启用'}
                        </button>
                        <button
                          onClick={() => handleDeleteAlertRule(r)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {alertRulesV2.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      暂无告警规则，点击「新建告警规则」配置 Run 失败/回归通知
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {alertEventsV2.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">最近告警事件</h3>
              <div className="bg-white border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left">时间</th>
                      <th className="px-4 py-2 text-left">级别</th>
                      <th className="px-4 py-2 text-left">消息</th>
                      <th className="px-4 py-2 text-left">投递</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alertEventsV2.map((e) => (
                      <tr key={e.id} className="border-t">
                        <td className="px-4 py-2 text-gray-500">{new Date(e.created_at).toLocaleString('zh-CN')}</td>
                        <td className="px-4 py-2">
                          <span className={`px-1.5 py-0.5 rounded ${
                            e.severity === 'critical' ? 'bg-red-100 text-red-700'
                            : e.severity === 'warning' ? 'bg-amber-100 text-amber-700'
                            : 'bg-blue-100 text-blue-700'
                          }`}>{e.severity}</span>
                        </td>
                        <td className="px-4 py-2">
                          {e.message}
                          {e.payload && typeof (e.payload as { runId?: string }).runId === 'string' && (
                            <a href={`/evaluation/runs/${(e.payload as { runId: string }).runId}`} className="ml-2 text-blue-600 underline">
                              查看 Run
                            </a>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <span className={
                            e.delivery_status === 'delivered' ? 'text-green-700'
                            : e.delivery_status === 'failed' ? 'text-red-700'
                            : 'text-gray-500'
                          }>
                            {e.delivery_status === 'delivered' && '已投递'}
                            {e.delivery_status === 'failed' && `投递失败：${e.delivery_error ?? ''}`}
                            {e.delivery_status === 'skipped' && '站内'}
                            {e.delivery_status === 'pending' && '待投递'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Alert Rule 创建弹窗 */}
      {showAlertModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <form onSubmit={handleCreateAlertRule} className="bg-white rounded-lg p-6 w-full max-w-lg">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium">新建告警规则</h3>
              <button type="button" onClick={() => setShowAlertModal(false)} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-700 mb-1">规则名称</label>
                <input
                  value={alertForm.name}
                  onChange={(ev) => setAlertForm({ ...alertForm, name: ev.target.value })}
                  required
                  className="w-full border rounded px-3 py-2 text-sm"
                  placeholder="如：生产回归失败告警"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">触发事件</label>
                <select
                  value={alertForm.event_type}
                  onChange={(ev) => setAlertForm({ ...alertForm, event_type: ev.target.value as typeof alertForm.event_type })}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  <option value="run_failed">Run 失败（critical）</option>
                  <option value="run_regression">通过率回归（warning，需设阈值）</option>
                  <option value="run_completed">Run 完成（info，每次完成通知）</option>
                </select>
              </div>
              {alertForm.event_type === 'run_regression' && (
                <div>
                  <label className="block text-sm text-gray-700 mb-1">通过率阈值（低于则告警）</label>
                  <input
                    type="number"
                    step={0.05}
                    min={0}
                    max={1}
                    value={alertForm.threshold}
                    onChange={(ev) => setAlertForm({ ...alertForm, threshold: Number(ev.target.value) })}
                    className="w-full border rounded px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-gray-400 mt-1">0.8 表示通过率低于 80% 时触发</p>
                </div>
              )}
              <div>
                <label className="block text-sm text-gray-700 mb-1">Webhook 地址（可选，留空仅站内记录）</label>
                <input
                  value={alertForm.webhook_url}
                  onChange={(ev) => setAlertForm({ ...alertForm, webhook_url: ev.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm font-mono"
                  placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">冷却时间（分钟）</label>
                <input
                  type="number"
                  min={1}
                  value={alertForm.cooldown_minutes}
                  onChange={(ev) => setAlertForm({ ...alertForm, cooldown_minutes: Number(ev.target.value) })}
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button type="button" onClick={() => setShowAlertModal(false)} className="px-4 py-2 text-sm border rounded hover:bg-gray-50">
                取消
              </button>
              <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                创建
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Experiment Report Modal */}
      {showReportModal && experimentReports[showReportModal] && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium">{t.experimentReport}</h3>
              <button onClick={() => setShowReportModal(null)} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>
            {(() => {
              const report = experimentReports[showReportModal];
              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-4 gap-4">
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-xs text-gray-500">{t.totalCases}</div>
                      <div className="text-lg font-medium">{report.totalItems}</div>
                    </div>
                    <div className="bg-green-50 p-3 rounded">
                      <div className="text-xs text-gray-500">{t.passedCases}</div>
                      <div className="text-lg font-medium text-green-700">{report.passedCount}</div>
                    </div>
                    <div className="bg-red-50 p-3 rounded">
                      <div className="text-xs text-gray-500">{t.failedCases}</div>
                      <div className="text-lg font-medium text-red-700">{report.failedCount}</div>
                    </div>
                    <div className="bg-blue-50 p-3 rounded">
                      <div className="text-xs text-gray-500">{t.passRate}</div>
                      <div className="text-lg font-medium text-blue-700">{report.passRate}%</div>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">{t.badCases}</h4>
                    <div className="space-y-2">
                      {report.failedCount === 0 && (
                        <div className="text-sm text-gray-500">{t.noBadCases}</div>
                      )}
                      {(badCases[showReportModal] || []).map((bc) => (
                        <div key={bc.id} className="border rounded p-3 text-sm">
                          <div className="flex justify-between items-start">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-gray-500 mb-1">{t.inputLabel}</div>
                              <div className="truncate">{bc.input}</div>
                              {bc.expected_output && (
                                <div className="mt-1">
                                  <div className="text-xs text-gray-500">{t.expectedOutput}</div>
                                  <div className="truncate text-green-700">{bc.expected_output}</div>
                                </div>
                              )}
                              <div className="mt-1">
                                <div className="text-xs text-gray-500">{t.actualOutput}</div>
                                <div className="truncate">{bc.output || '-'}</div>
                              </div>
                              <div className="mt-1 flex items-center gap-2">
                                <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded">{t.scoreLabel}: {bc.score}</span>
                                {bc.calibrated_score !== undefined && bc.calibrated_score !== null && (
                                  <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded">{t.calibratedAfter}: {bc.calibrated_score}</span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => { setCalibratingResult(bc.id); setCalibrationForm({ score: bc.calibrated_score ?? bc.score ?? 0, passed: !!(bc.calibrated_passed ?? bc.passed), note: bc.calibration_note || '' }); }}
                              className="text-xs px-2 py-1 border rounded hover:bg-gray-50 ml-2 shrink-0"
                            >
                              {t.calibrate}
                            </button>
                          </div>
                          {calibratingResult === bc.id && (
                            <div className="mt-3 border-t pt-3 space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-xs text-gray-500">{t.calibrateScore}</label>
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={calibrationForm.score}
                                    onChange={(e) => setCalibrationForm({ ...calibrationForm, score: Number(e.target.value) })}
                                    className="w-full px-2 py-1 border rounded text-sm"
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <label className="text-xs text-gray-500">{t.calibratePassed}</label>
                                  <input
                                    type="checkbox"
                                    checked={calibrationForm.passed}
                                    onChange={(e) => setCalibrationForm({ ...calibrationForm, passed: e.target.checked })}
                                    className="w-4 h-4"
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500">{t.calibrateNote}</label>
                                <input
                                  type="text"
                                  value={calibrationForm.note}
                                  onChange={(e) => setCalibrationForm({ ...calibrationForm, note: e.target.value })}
                                  className="w-full px-2 py-1 border rounded text-sm"
                                  placeholder={t.calibrateReason}
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleCalibrateResult(bc.id)}
                                  className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                                >
                                  {t.saveCalibrate}
                                </button>
                                <button
                                  onClick={() => setCalibratingResult(null)}
                                  className="text-xs px-3 py-1 border rounded hover:bg-gray-50"
                                >
                                  {t.cancelCalibrate}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  {report.calibratedCount > 0 && (
                    <div className="text-sm text-amber-600">
                      {t.calibratedSummary.replace('{count}', String(report.calibratedCount)).replace('{rate}', String(report.calibrationRate))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Task Modal */}
      {showTaskModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium mb-4">{t.createAutoEvalTask}</h3>
            <form onSubmit={handleCreateAutoEvalTask}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.taskName}</label>
                  <input
                    type="text"
                    value={taskForm.name}
                    onChange={(e) => setTaskForm({ ...taskForm, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.selectDataset}</label>
                  <select
                    value={taskForm.dataset_id}
                    onChange={(e) => setTaskForm({ ...taskForm, dataset_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  >
                    <option value="">-- {t.selectDataset} --</option>
                    {datasets.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.selectEvaluator}</label>
                  <select
                    value={taskForm.evaluator_id}
                    onChange={(e) => setTaskForm({ ...taskForm, evaluator_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">-- {t.selectEvaluator} --</option>
                    {evaluators.map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t.intervalHours}</label>
                    <input
                      type="number"
                      value={taskForm.interval_hours}
                      onChange={(e) => setTaskForm({ ...taskForm, interval_hours: Number(e.target.value) })}
                      className="w-full px-3 py-2 border rounded-lg"
                      min={1}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t.sampleCount}</label>
                    <input
                      type="number"
                      value={taskForm.sample_count}
                      onChange={(e) => setTaskForm({ ...taskForm, sample_count: Number(e.target.value) })}
                      className="w-full px-3 py-2 border rounded-lg"
                      min={1}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="task-enabled"
                    type="checkbox"
                    checked={taskForm.enabled}
                    onChange={(e) => setTaskForm({ ...taskForm, enabled: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label htmlFor="task-enabled" className="text-sm text-gray-700">{t.enableTask}</label>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button type="button" onClick={() => setShowTaskModal(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
                  {t.cancelCreate}
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  {t.createTask}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dataset Modal */}
      {showDatasetModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium mb-4">{t.createDataset}</h3>
            <form onSubmit={handleCreateDataset}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.datasetName}</label>
                  <input
                    data-testid="dataset-name-input"
                    type="text"
                    value={datasetForm.name}
                    onChange={(e) => setDatasetForm({ ...datasetForm, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.datasetDescription}</label>
                  <input
                    data-testid="dataset-desc-input"
                    type="text"
                    value={datasetForm.description}
                    onChange={(e) => setDatasetForm({ ...datasetForm, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.datasetType}</label>
                  <select
                    data-testid="dataset-type-select"
                    value={datasetForm.type}
                    onChange={(e) => setDatasetForm({ ...datasetForm, type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="custom">custom</option>
                    <option value="qa">qa</option>
                    <option value="chat">chat</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="auto-create-evaluators"
                    type="checkbox"
                    checked={datasetForm.auto_create_evaluators}
                    onChange={(e) => setDatasetForm({ ...datasetForm, auto_create_evaluators: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label htmlFor="auto-create-evaluators" className="text-sm text-gray-700">
                    {t.autoCreatePresetEvaluators}
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button type="button" onClick={() => setShowDatasetModal(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
                  {t.cancel}
                </button>
                <button data-testid="dataset-submit-btn" type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  {t.create}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Items Modal */}
      {showItemsModal && selectedDataset && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg">
            <h3 className="text-lg font-medium mb-4">{t.addItems}</h3>
            <form onSubmit={handleAddItems}>
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {itemInputs.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-2 gap-2">
                    <input
                      data-testid={`item-input-${idx}`}
                      type="text"
                      placeholder={t.itemInput}
                      value={item.input}
                      onChange={(e) => {
                        const newItems = [...itemInputs];
                        newItems[idx].input = e.target.value;
                        setItemInputs(newItems);
                      }}
                      className="px-3 py-2 border rounded-lg"
                    />
                    <input
                      data-testid={`item-expected-${idx}`}
                      type="text"
                      placeholder={t.itemExpectedOutput}
                      value={item.expected_output}
                      onChange={(e) => {
                        const newItems = [...itemInputs];
                        newItems[idx].expected_output = e.target.value;
                        setItemInputs(newItems);
                      }}
                      className="px-3 py-2 border rounded-lg"
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setItemInputs([...itemInputs, { input: '', expected_output: '' }])}
                className="mt-3 text-sm text-blue-600 hover:underline"
              >
                + {t.addItems}
              </button>
              <div className="flex justify-end gap-2 mt-6">
                <button type="button" onClick={() => setShowItemsModal(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
                  {t.cancel}
                </button>
                <button data-testid="items-submit-btn" type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  {t.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Evaluator Modal */}
      {showEvaluatorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium mb-4">{t.createEvaluator}</h3>
            <form onSubmit={handleCreateEvaluator}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.evaluatorName}</label>
                  <input
                    data-testid="evaluator-name-input"
                    type="text"
                    value={evaluatorForm.name}
                    onChange={(e) => setEvaluatorForm({ ...evaluatorForm, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.presetTemplate}</label>
                  <select
                    value=""
                    onChange={(e) => {
                      const tmpl = evaluatorTemplates.find(t => t.id === e.target.value);
                      if (tmpl) {
                        setEvaluatorForm({
                          name: tmpl.name,
                          type: tmpl.type,
                          description: tmpl.description,
                          config: JSON.stringify(tmpl.default_config, null, 2),
                        });
                      }
                    }}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">{t.selectPresetTemplate}</option>
                    {evaluatorTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} ({t.type})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.evaluatorType}</label>
                  <select
                    data-testid="evaluator-type-select"
                    value={evaluatorForm.type}
                    onChange={(e) => setEvaluatorForm({ ...evaluatorForm, type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="exact_match">exact_match</option>
                    <option value="contains">contains</option>
                    <option value="llm_judge">llm_judge</option>
                    <option value="regex">regex</option>
                    <option value="similarity">similarity</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.description}</label>
                  <input
                    type="text"
                    value={evaluatorForm.description}
                    onChange={(e) => setEvaluatorForm({ ...evaluatorForm, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button type="button" onClick={() => setShowEvaluatorModal(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
                  {t.cancel}
                </button>
                <button data-testid="evaluator-submit-btn" type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  {t.create}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Experiment Modal */}
      {showExperimentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium mb-4">{t.createExperiment}</h3>
            <form onSubmit={handleCreateExperiment}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.experimentName}</label>
                  <input
                    data-testid="experiment-name-input"
                    type="text"
                    value={experimentForm.name}
                    onChange={(e) => setExperimentForm({ ...experimentForm, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.selectDataset}</label>
                  <select
                    data-testid="experiment-dataset-select"
                    value={experimentForm.dataset_id}
                    onChange={(e) => setExperimentForm({ ...experimentForm, dataset_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  >
                    <option value="">-- {t.selectDataset} --</option>
                    {datasets.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.selectEvaluator} <span className="text-red-500">*</span></label>
                  <select
                    data-testid="experiment-evaluator-select"
                    value={experimentForm.evaluator_id}
                    onChange={(e) => setExperimentForm({ ...experimentForm, evaluator_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  >
                    <option value="">-- {t.selectEvaluator} --</option>
                    {evaluators.map((ev) => (
                      <option key={ev.id} value={ev.id}>{ev.name} ({ev.type})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.modelConfig} <span className="text-red-500">*</span></label>
                  <select
                    value={experimentForm.model_config_id}
                    onChange={(e) => setExperimentForm({ ...experimentForm, model_config_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  >
                    <option value="">-- {t.modelConfig} --</option>
                    {modelConfigs.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.model})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prompt（可选，用于系统提示词版本锁定）</label>
                  <select
                    value={experimentForm.prompt_id}
                    onChange={(e) => setExperimentForm({ ...experimentForm, prompt_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">-- 不使用 Prompt --</option>
                    {prompts.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{p.current_version_id ? ` (v${p.current_version_id.slice(0, 8)})` : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Temperature</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={experimentForm.temperature}
                      onChange={(e) => setExperimentForm({ ...experimentForm, temperature: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      placeholder="默认 0.7"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Max Tokens</label>
                    <input
                      type="number"
                      min="1"
                      value={experimentForm.max_tokens}
                      onChange={(e) => setExperimentForm({ ...experimentForm, max_tokens: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      placeholder="默认 2048"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.description}</label>
                  <input
                    type="text"
                    value={experimentForm.description}
                    onChange={(e) => setExperimentForm({ ...experimentForm, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button type="button" onClick={() => setShowExperimentModal(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
                  {t.cancel}
                </button>
                <button data-testid="experiment-submit-btn" type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  {t.create}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
