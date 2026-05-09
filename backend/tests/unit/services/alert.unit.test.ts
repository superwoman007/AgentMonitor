import {
  createAlert,
  getAlertsByProject,
  getAlertById,
  updateAlert,
  deleteAlert,
  toggleAlert,
  checkAlerts,
  getAlertHistory,
  ignoreAlertHistory,
} from '../../../src/services/alert.js';

describe('Alert Service', () => {
  // 每个测试前清理 store（alert service 使用内存 Map）
  let projectId: string;

  beforeEach(() => {
    projectId = `test-project-${Date.now()}`;
  });

  describe('createAlert', () => {
    it('应该创建告警并返回完整对象', () => {
      const alert = createAlert({
        projectId,
        name: '延迟告警',
        type: 'latency',
        condition: '>1000',
        threshold: 1000,
      });

      expect(alert).toHaveProperty('id');
      expect(alert.projectId).toBe(projectId);
      expect(alert.name).toBe('延迟告警');
      expect(alert.type).toBe('latency');
      expect(alert.threshold).toBe(1000);
      expect(alert.enabled).toBe(true);
      expect(alert.lastTriggered).toBeNull();
    });

    it('应该支持 enabled=false 创建', () => {
      const alert = createAlert({
        projectId,
        name: '禁用告警',
        type: 'error_rate',
        condition: '>0.1',
        threshold: 0.1,
        enabled: false,
      });

      expect(alert.enabled).toBe(false);
    });
  });

  describe('getAlertsByProject', () => {
    it('应该返回项目的所有告警', () => {
      createAlert({ projectId, name: 'a1', type: 'latency', condition: '', threshold: 100 });
      createAlert({ projectId, name: 'a2', type: 'cost', condition: '', threshold: 10 });

      const alerts = getAlertsByProject(projectId);
      expect(alerts.length).toBeGreaterThanOrEqual(2);
      expect(alerts.every((a) => a.projectId === projectId)).toBe(true);
    });

    it('应该不返回其他项目的告警', () => {
      createAlert({ projectId: 'other-project', name: 'other', type: 'latency', condition: '', threshold: 100 });
      const alerts = getAlertsByProject(projectId);
      expect(alerts.every((a) => a.projectId === projectId)).toBe(true);
    });
  });

  describe('getAlertById', () => {
    it('应该返回指定告警', () => {
      const created = createAlert({ projectId, name: 'find-me', type: 'latency', condition: '', threshold: 100 });
      const found = getAlertById(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it('应该对不存在的 id 返回 null', () => {
      expect(getAlertById('nonexistent')).toBeNull();
    });
  });

  describe('updateAlert', () => {
    it('应该更新告警属性', () => {
      const alert = createAlert({ projectId, name: 'original', type: 'latency', condition: '', threshold: 100 });
      const updated = updateAlert(alert.id, { name: 'updated', threshold: 200 });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('updated');
      expect(updated!.threshold).toBe(200);
    });

    it('应该对不存在的 id 返回 null', () => {
      expect(updateAlert('nonexistent', { name: 'x' })).toBeNull();
    });
  });

  describe('deleteAlert', () => {
    it('应该删除告警并返回 true', () => {
      const alert = createAlert({ projectId, name: 'delete-me', type: 'latency', condition: '', threshold: 100 });
      expect(deleteAlert(alert.id)).toBe(true);
      expect(getAlertById(alert.id)).toBeNull();
    });

    it('应该对不存在的 id 返回 false', () => {
      expect(deleteAlert('nonexistent')).toBe(false);
    });
  });

  describe('toggleAlert', () => {
    it('应该切换 enabled 状态', () => {
      const alert = createAlert({ projectId, name: 'toggle', type: 'latency', condition: '', threshold: 100 });
      expect(alert.enabled).toBe(true);

      const toggled = toggleAlert(alert.id);
      expect(toggled!.enabled).toBe(false);

      const toggledBack = toggleAlert(alert.id);
      expect(toggledBack!.enabled).toBe(true);
    });

    it('应该对不存在的 id 返回 null', () => {
      expect(toggleAlert('nonexistent')).toBeNull();
    });
  });

  describe('checkAlerts', () => {
    it('应该触发延迟告警', () => {
      const pid = `latency-trigger-${Date.now()}`;
      createAlert({ projectId: pid, name: '延迟', type: 'latency', condition: '>1000', threshold: 1000 });

      const triggered = checkAlerts(pid, { avgLatency: 1500 });
      expect(triggered.length).toBe(1);
      expect(triggered[0].alertType).toBe('latency');
      expect(triggered[0].actual).toBe(1500);
      expect(triggered[0].message).toContain('1500');
    });

    it('应该不触发未超阈值的延迟告警', () => {
      const pid = `no-trigger-${Date.now()}`;
      createAlert({ projectId: pid, name: '延迟', type: 'latency', condition: '>1000', threshold: 1000 });

      const triggered = checkAlerts(pid, { avgLatency: 500 });
      expect(triggered.length).toBe(0);
    });

    it('应该触发错误率告警', () => {
      const pid = `err-${Date.now()}`;
      createAlert({ projectId: pid, name: '错误率', type: 'error_rate', condition: '>0.1', threshold: 0.1 });

      const triggered = checkAlerts(pid, { errorRate: 0.25 });
      expect(triggered.length).toBe(1);
      expect(triggered[0].alertType).toBe('error_rate');
    });

    it('应该触发成本告警', () => {
      const pid = `cost-${Date.now()}`;
      createAlert({ projectId: pid, name: '成本', type: 'cost', condition: '>10', threshold: 10 });

      const triggered = checkAlerts(pid, { dailyCost: 15.5 });
      expect(triggered.length).toBe(1);
      expect(triggered[0].alertType).toBe('cost');
    });

    it('应该不触发禁用的告警', () => {
      const pid = `disabled-${Date.now()}`;
      createAlert({ projectId: pid, name: '禁用', type: 'latency', condition: '', threshold: 100, enabled: false });

      const triggered = checkAlerts(pid, { avgLatency: 9999 });
      expect(triggered.length).toBe(0);
    });

    it('应该同时触发多个告警', () => {
      const pid = `multi-${Date.now()}`;
      createAlert({ projectId: pid, name: '延迟', type: 'latency', condition: '', threshold: 1000 });
      createAlert({ projectId: pid, name: '错误率', type: 'error_rate', condition: '', threshold: 0.1 });

      const triggered = checkAlerts(pid, { avgLatency: 2000, errorRate: 0.5 });
      expect(triggered.length).toBe(2);
    });

    it('应该记录告警历史', () => {
      const pid = `history-${Date.now()}`;
      createAlert({ projectId: pid, name: '历史', type: 'latency', condition: '', threshold: 100 });

      checkAlerts(pid, { avgLatency: 500 });

      const history = getAlertHistory(pid);
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].projectId).toBe(pid);
    });

    it('应该触发自定义告警', () => {
      const pid = `custom-${Date.now()}`;
      createAlert({
        projectId: pid,
        name: '自定义',
        type: 'custom',
        condition: 'context.metrics.avgLatency > 500 && context.metrics.errorRate > 0.05',
        threshold: 0,
      });

      const triggered = checkAlerts(pid, { avgLatency: 1000, errorRate: 0.1 });
      expect(triggered.length).toBe(1);
      expect(triggered[0].alertType).toBe('custom');
    });
  });

  describe('ignoreAlertHistory', () => {
    it('应该抑制告警', () => {
      const pid = `suppress-${Date.now()}`;
      createAlert({ projectId: pid, name: '抑制', type: 'latency', condition: '', threshold: 100 });

      // 第一次触发
      const triggered1 = checkAlerts(pid, { avgLatency: 500 });
      expect(triggered1.length).toBe(1);

      // 抑制
      const result = ignoreAlertHistory(triggered1[0].id, 60);
      expect(result).not.toBeNull();
      expect(result!.mutedUntil.getTime()).toBeGreaterThan(Date.now());

      // 抑制期间不应再触发
      const triggered2 = checkAlerts(pid, { avgLatency: 500 });
      expect(triggered2.length).toBe(0);
    });

    it('应该对不存在的历史 id 返回 null', () => {
      expect(ignoreAlertHistory('nonexistent', 60)).toBeNull();
    });

    it('应该对无效分钟数返回 null', () => {
      const pid = `invalid-${Date.now()}`;
      createAlert({ projectId: pid, name: 'test', type: 'latency', condition: '', threshold: 100 });
      const triggered = checkAlerts(pid, { avgLatency: 500 });
      if (triggered.length > 0) {
        expect(ignoreAlertHistory(triggered[0].id, -1)).toBeNull();
        expect(ignoreAlertHistory(triggered[0].id, 0)).toBeNull();
      }
    });
  });
});
