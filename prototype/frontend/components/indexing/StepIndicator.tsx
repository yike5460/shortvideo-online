interface StepIndicatorProps {
  currentStep: number
  totalSteps: number
}

export default function StepIndicator({ currentStep, totalSteps }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center space-x-2">
      {Array.from({ length: totalSteps }).map((_, index) => (
        <div
          key={index}
          className={`h-2 w-2 rounded-full ${
            index < currentStep ? 'bg-primary-600' : 'bg-gray-300'
          }`}
        />
      ))}
    </div>
  )
} 