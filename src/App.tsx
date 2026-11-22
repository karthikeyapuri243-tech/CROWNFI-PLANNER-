                        <p className="text-[10px] text-emerald-700 font-black mt-1 font-mono">+15 XP each</p>
                      </div>
                    </div>

                    <div className="border border-natborder/60 rounded-xl p-3 bg-cardbg flex items-start gap-3">
                      <div className="text-lg bg-amber-500/10 p-2 rounded-lg text-amber-700 font-bold leading-none shrink-0">🩹</div>
                      <div>
                        <p className="text-xs font-bold text-nattext">Healthy Skip / Rest Day</p>
                        <p className="text-[10px] text-natmuted mt-0.5">Take designated recovery or rest days.</p>
                        <p className="text-[10px] text-amber-700 font-black mt-1 font-mono">+5 XP each</p>
                      </div>
                    </div>

                    <div className="border border-natborder/60 rounded-xl p-3 bg-cardbg flex items-start gap-3">
                      <div className="text-lg bg-purple-500/10 p-2 rounded-lg text-purple-700 font-bold leading-none shrink-0">📋</div>
                      <div>
                        <p className="text-xs font-bold text-nattext">Check Off Subtasks</p>
                        <p className="text-[10px] text-natmuted mt-0.5">Complete nested steps in task checklists.</p>
                        <p className="text-[10px] text-purple-700 font-black mt-1 font-mono">+2 XP each step</p>
                      </div>
                    </div>

                    <div className="border border-natborder/60 rounded-xl p-3 bg-cardbg flex items-start gap-3">
                      <div className="text-lg bg-indigo-500/10 p-2 rounded-lg text-indigo-700 font-bold leading-none shrink-0">⚡</div>
                      <div>
                        <p className="text-xs font-bold text-nattext">Perfect Task Streak</p>
                        <p className="text-[10px] text-natmuted mt-0.5">Complete all scheduled tasks on any given day.</p>
                        <p className="text-[10px] text-indigo-700 font-black mt-1 font-mono">+40 XP per active day</p>
                      </div>
                    </div>

                    <div className="border border-natborder/60 rounded-xl p-3 bg-cardbg flex items-start gap-3">
                      <div className="text-lg bg-rose-500/10 p-2 rounded-lg text-rose-700 font-bold leading-none shrink-0">🔥</div>
                      <div>
                        <p className="text-xs font-bold text-nattext">Habit Streak Multiplier</p>
                        <p className="text-[10px] text-natmuted mt-0.5">Keep habit streaks alive! Your best streak multiplies gains.</p>
                        <p className="text-[10px] text-rose-700 font-black mt-1 font-mono">+25 XP per streak day</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Achievements Milestones list */}
                <div className="space-y-3">
                  <h4 className="font-serif font-bold text-sm text-nattext flex items-center gap-1.5">
                    <Award className="w-4 h-4 text-olive" />
                    Unlocked Achievements & Badges
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {earnedBadges.list.map(badge => (
                      <div
                        key={badge.id}
                        className={`border rounded-xl p-3.5 transition-all flex items-start gap-3.5 relative ${
                          badge.unlocked
                            ? `${badge.color} border-olive/30 shadow-3xs`
                            : 'bg-cardbg/40 border-natborder/40 opacity-55'
                        }`}
                      >
                        <div className="text-2xl select-none shrink-0 p-1.5 rounded-xl bg-cardbg border border-natborder/50">
                          {badge.unlocked ? badge.icon : '🔒'}
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-xs font-bold text-nattext flex items-center gap-1.5">
                            {badge.name}
                            {badge.unlocked && (
                              <span className="text-[9px] font-black uppercase text-emerald-700 bg-emerald-50 px-1 rounded-sm border border-emerald-200">Earned</span>
                            )}
                          </p>
                          <p className="text-[10px] text-natmuted leading-relaxed">{badge.description}</p>
                          <p className="text-[10px] text-natmuted pt-1">
                            <strong className="font-semibold">Requirement:</strong> {badge.requirement}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="border-t border-natborder bg-subtlebg px-6 py-4 flex justify-end">
                <button
                  onClick={() => setShowMojoModal(false)}
                  className="px-5 py-2 rounded-xl bg-olive hover:bg-olive/90 text-white font-semibold text-xs transition-all cursor-pointer shadow-3xs"
                >
                  Awesome, keep focusing!
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Aura Real-Time Assistant Panel Overlay */}
      {showAssistant && (
        <AuraAssistant
          tasks={tasks}
          habits={habits}
          habitLogs={habitLogs}
          selectedDate={selectedDate}
          onClose={() => setShowAssistant(false)}
        />
      )}

      {/* Customizable Medium-Speed Smooth Scroller Compass */}
      <PageScrollAssistant />
    </div>
  );
}
