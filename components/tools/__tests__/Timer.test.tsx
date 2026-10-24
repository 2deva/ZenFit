import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Timer } from '../Timer';
const app = vi.hoisted(() => ({ activitySessions: {} as Record<string, any> }));
vi.mock('../../../contexts/AppContext', () => ({ useAppContext: () => app }));

describe('controlled timer UI', () => {
  it('requests start, pause and reset through the owning activity engine', () => {
    const onStateChange = vi.fn();
    const { rerender } = render(<Timer label="Reset" durationSeconds={90} controlledTimeLeft={90} onStateChange={onStateChange} />);
    expect(screen.getByText('1:30')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ isRunning: true, remainingSeconds: 90 }));
    rerender(<Timer label="Reset" durationSeconds={90} controlledTimeLeft={75} controlledIsRunning onStateChange={onStateChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause timer' }));
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ isRunning: false, remainingSeconds: 75 }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset timer' }));
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ isRunning: false, remainingSeconds: 90 }));
  });
  it('fires completion only once, including repeated completed renders', () => {
    const onComplete = vi.fn(); const { rerender } = render(<Timer durationSeconds={5} controlledTimeLeft={5} onComplete={onComplete} />);
    rerender(<Timer durationSeconds={5} controlledTimeLeft={0} onComplete={onComplete} />);
    rerender(<Timer durationSeconds={5} controlledTimeLeft={0} controlledIsCompleted onComplete={onComplete} />);
    expect(onComplete).toHaveBeenCalledOnce(); expect(screen.getByText('Complete!')).toBeInTheDocument();
  });
  it('does not replay a completion event when mounting an already completed timer', () => {
    const onComplete = vi.fn(); render(<Timer controlledTimeLeft={0} controlledIsCompleted onComplete={onComplete} />);
    expect(onComplete).not.toHaveBeenCalled();
  });
  it('delegates Live controls and displays guidance', () => {
    const onLiveControl = vi.fn(); render(<Timer isLiveMode controlledIsRunning controlledTimeLeft={30} onLiveControl={onLiveControl} currentGuidanceText="Breathe slowly" guidanceMessages={[{ id: 'g', text: 'Relax your shoulders', timestamp: 1 }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause timer' })); expect(onLiveControl).toHaveBeenCalledWith('pause');
    fireEvent.click(screen.getByRole('button', { name: 'Reset timer' })); expect(onLiveControl).toHaveBeenCalledWith('stop');
    expect(screen.getByText('Relax your shoulders')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Session Guidance/ })); expect(screen.queryByText('Relax your shoulders')).not.toBeInTheDocument();
  });
  it('uses the shared mindful phase model', () => {
    app.activitySessions = { mind: { id: 'mind', label: 'Mindful', type: 'breathing', state: 'running', intent: 'breathing_reset', phases: [{ id: 'breath', kind: 'breath_cycle', durationSeconds: 60, order: 0 }] } };
    render(<Timer label="Mindful" controlledIsRunning controlledTimeLeft={30} />);
    expect(screen.getByText('Follow the inhale and exhale, nothing else to do.')).toBeInTheDocument();
    app.activitySessions = {};
  });
});
