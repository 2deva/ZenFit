import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkoutList } from '../WorkoutList';

vi.mock('../../../contexts/AppContext', () => ({ useAppContext: () => ({ workoutProgress: {} }) }));
vi.mock('../../../supabaseConfig', () => ({ supabase: {}, isSupabaseConfigured: false }));
vi.mock('../../../services/persistenceService', () => ({ syncWorkoutProgressFromCloud: vi.fn(), syncWorkoutProgressToCloud: vi.fn() }));
vi.mock('../ExerciseGuide', () => ({ ExerciseGuide: () => null }));

describe('WorkoutList', () => {
  it.each([
    [{ name: 'Plank', duration: '30 seconds' }, 'Plank', '30 seconds'],
    [{ name: 'Plank 2 minutes' }, 'Plank', '2 min'],
    [{ name: 'Hold 1:30' }, 'Hold', '1:30'],
    [{ name: 'Squat', reps: '8 reps' }, 'Squat', '8 reps'],
  ])('renders exercise timing from %j', (exercise, name, duration) => {
    render(<WorkoutList title="Test workout" exercises={[exercise]} />);
    expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getAllByText(duration).length).toBeGreaterThan(0);
  });
  it('renders an empty state and can later receive exercises', () => {
    const { rerender } = render(<WorkoutList title="Workout" exercises={[]} />);
    expect(screen.getByText('No exercises found')).toBeInTheDocument();
    rerender(<WorkoutList title="Workout" exercises={[{ name: 'Plank', duration: '30 seconds' }]} />);
    expect(screen.getByText('Plank')).toBeInTheDocument();
    rerender(<WorkoutList title="Workout" exercises={[]} />);
    expect(screen.getByText('No exercises found')).toBeInTheDocument();
  });
  it('filters malformed exercises', () => {
    render(<WorkoutList title="Workout" exercises={[null, { name: 42 }] as never} />);
    expect(screen.getByText('No exercises found')).toBeInTheDocument();
  });
  it('renders all rounds', () => {
    render(<WorkoutList title="Workout" exercises={[{ name: 'Squat', reps: '8 reps' }]} rounds={2} />);
    expect(screen.getAllByText('Squat')).toHaveLength(2);
  });
});
